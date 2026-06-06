import Router from '@koa/router'
import { searchRequestSchema, type SearchResponse } from '@jnowledge/shared'
import type { Container } from '../container.js'
import { type AppState, requirePrincipal } from '../http/state.js'

export function createSearchController(c: Container): Router<AppState> {
  const router = new Router<AppState>()
  const { search } = c.services

  router.use(c.requireAuth)

  // 全局检索：纯相关性排序的文档列表，无 LLM 推理、无会话、无落库。
  router.post('/search', async (ctx) => {
    const req = searchRequestSchema.parse(ctx.request.body)
    const hits = await search.search(requirePrincipal(ctx.state), req.query)
    ctx.body = { query: req.query, hits } satisfies SearchResponse
  })

  return router
}
