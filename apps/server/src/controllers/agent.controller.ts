import Router from '@koa/router'
import { agentAskRequestSchema } from '@jnowledge/shared'
import type { RawContextStreamEvent } from '@jnowledge/shared'
import type { Container } from '../container.js'
import { type AppState, requirePrincipal } from '../http/state.js'

export function createAgentController(c: Container): Router<AppState> {
  const router = new Router<AppState>()
  const { agent } = c.services

  router.use(c.requireAuth)

  // Agent 问答（SSE 流式，DESIGN §8.9）：下发**原始上下文事件流**——
  // run（run 树节点）/ item（条目落定，含子 agent internal）/ patch（落定前 text·reasoning 增量）；出错走 error。
  // 前端按到达序累积 raw、跑共享投影派生视图（用户消息 + 子 agent 参与方泳道）。
  router.post('/conversations/:id/agent', async (ctx) => {
    const req = agentAskRequestSchema.parse(ctx.request.body)
    const p = requirePrincipal(ctx.state)

    ctx.req.socket.setTimeout(0)
    ctx.set('Content-Type', 'text/event-stream; charset=utf-8')
    ctx.set('Cache-Control', 'no-cache, no-transform')
    ctx.set('Connection', 'keep-alive')
    ctx.set('X-Accel-Buffering', 'no') // 禁用 nginx 缓冲
    ctx.status = 200
    ctx.flushHeaders()
    // 手动接管响应（绕过 Koa 的 body 处理）。
    ctx.respond = false

    const res = ctx.res
    const send = (ev: RawContextStreamEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`)

    try {
      for await (const ev of agent.ask(p, ctx.params.id!, req.question, {
        ...(req.tier !== undefined ? { tier: req.tier } : {}),
        ...(req.thinking !== undefined ? { thinking: req.thinking } : {}),
      })) {
        if (res.writableEnded) break // 客户端断开则停止拉取
        send(ev)
      }
    } catch (err) {
      // ask 内部已兜底 error 事件；此处仅防御未预期异常。
      c.logger.error({ err }, 'Agent SSE 流异常')
      if (!res.writableEnded) {
        send({ type: 'error', message: err instanceof Error ? err.message : '流式异常' })
      }
    } finally {
      if (!res.writableEnded) res.end()
    }
  })

  return router
}
