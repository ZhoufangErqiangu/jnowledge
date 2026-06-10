import Router from '@koa/router'
import { agentAskRequestSchema } from '@jnowledge/shared'
import type { AgentStreamEvent } from '@jnowledge/shared'
import type { Container } from '../container.js'
import { type AppState, requirePrincipal } from '../http/state.js'

export function createAgentController(c: Container): Router<AppState> {
  const router = new Router<AppState>()
  const { agent } = c.services

  router.use(c.requireAuth)

  // Agent 问答（SSE 流式）。与 RAG 的 /ask 并存，互不影响。
  // step_start/tool_result（执行轨迹）→ reasoning/token（增量）→ citations → done；出错走 error 事件。
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
    const send = (ev: AgentStreamEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`)

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
