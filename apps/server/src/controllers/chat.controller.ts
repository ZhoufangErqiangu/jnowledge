import Router from '@koa/router'
import { askRequestSchema, createConversationRequestSchema } from '@jnowledge/shared'
import type { ChatStreamEvent } from '@jnowledge/shared'
import type { Container } from '../container.js'
import { type AppState, requirePrincipal } from '../http/state.js'

export function createChatController(c: Container): Router<AppState> {
  const router = new Router<AppState>()
  const { chat } = c.services

  router.use(c.requireAuth)

  // 新建会话
  router.post('/conversations', async (ctx) => {
    const req = createConversationRequestSchema.parse(ctx.request.body)
    ctx.status = 201
    ctx.body = await chat.createConversation(requirePrincipal(ctx.state), req)
  })

  // 某知识库下我的会话列表
  router.get('/collections/:collectionId/conversations', async (ctx) => {
    ctx.body = await chat.listConversations(requirePrincipal(ctx.state), ctx.params.collectionId!)
  })

  // 我的全局会话列表（不绑库，仅 agent 模式）
  router.get('/conversations', async (ctx) => {
    ctx.body = await chat.listGlobalConversations(requirePrincipal(ctx.state))
  })

  // 会话详情（含全部消息）
  router.get('/conversations/:id', async (ctx) => {
    ctx.body = await chat.getConversation(requirePrincipal(ctx.state), ctx.params.id!)
  })

  // 删除会话（软删）
  router.delete('/conversations/:id', async (ctx) => {
    await chat.removeConversation(requirePrincipal(ctx.state), ctx.params.id!)
    ctx.status = 204
  })

  // 提问（SSE 流式）。token/reasoning 增量 → citations → done；出错走 error 事件。
  router.post('/conversations/:id/ask', async (ctx) => {
    const req = askRequestSchema.parse(ctx.request.body)
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
    const send = (ev: ChatStreamEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`)

    try {
      for await (const ev of chat.ask(p, ctx.params.id!, req.question)) {
        if (res.writableEnded) break // 客户端断开则停止拉取
        send(ev)
      }
    } catch (err) {
      // ask 内部已兜底 error 事件；此处仅防御未预期异常。
      c.logger.error({ err }, 'SSE 流异常')
      if (!res.writableEnded) {
        send({ type: 'error', message: err instanceof Error ? err.message : '流式异常' })
      }
    } finally {
      if (!res.writableEnded) res.end()
    }
  })

  return router
}
