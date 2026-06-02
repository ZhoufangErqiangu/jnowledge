import Router from '@koa/router'
import {
  addMemberRequestSchema,
  createCollectionRequestSchema,
  updateCollectionRequestSchema,
} from '@jnowledge/shared'
import type { Container } from '../container.js'
import { type AppState, requirePrincipal } from '../http/state.js'

export function createCollectionController(c: Container): Router<AppState> {
  const router = new Router<AppState>({ prefix: '/collections' })
  const { collections } = c.services

  // 整个 controller 需要登录
  router.use(c.requireAuth)

  // 文件夹树
  router.get('/tree', async (ctx) => {
    ctx.body = await collections.getTree(requirePrincipal(ctx.state))
  })

  // 新建知识库
  router.post('/', async (ctx) => {
    const req = createCollectionRequestSchema.parse(ctx.request.body)
    ctx.status = 201
    ctx.body = await collections.create(requirePrincipal(ctx.state), req)
  })

  // 详情
  router.get('/:id', async (ctx) => {
    ctx.body = await collections.getById(requirePrincipal(ctx.state), ctx.params.id!)
  })

  // 更新
  router.patch('/:id', async (ctx) => {
    const req = updateCollectionRequestSchema.parse(ctx.request.body)
    ctx.body = await collections.update(requirePrincipal(ctx.state), ctx.params.id!, req)
  })

  // 删除（软删）
  router.delete('/:id', async (ctx) => {
    await collections.remove(requirePrincipal(ctx.state), ctx.params.id!)
    ctx.status = 204
  })

  // 成员列表
  router.get('/:id/members', async (ctx) => {
    ctx.body = await collections.listMembers(requirePrincipal(ctx.state), ctx.params.id!)
  })

  // 添加/更新成员
  router.post('/:id/members', async (ctx) => {
    const req = addMemberRequestSchema.parse(ctx.request.body)
    ctx.status = 201
    ctx.body = await collections.addMember(requirePrincipal(ctx.state), ctx.params.id!, req)
  })

  // 移除成员
  router.delete('/:id/members/:userId', async (ctx) => {
    await collections.removeMember(
      requirePrincipal(ctx.state),
      ctx.params.id!,
      ctx.params.userId!,
    )
    ctx.status = 204
  })

  return router
}
