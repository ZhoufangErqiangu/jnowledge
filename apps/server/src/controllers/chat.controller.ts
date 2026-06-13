import Router from '@koa/router'
import { createConversationRequestSchema } from '@jnowledge/shared'
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

  // 我的会话列表（统一为全局 agent 会话）
  router.get('/conversations', async (ctx) => {
    ctx.body = await chat.listConversations(requirePrincipal(ctx.state))
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

  return router
}
