import Router from '@koa/router'
import { loginRequestSchema, registerRequestSchema } from '@jnowledge/shared'
import type { Container } from '../container.js'
import type { AppState } from '../http/state.js'
import { toPublicUser } from '../models/index.js'
import { requirePrincipal } from '../http/state.js'

export function createAuthController(c: Container): Router<AppState> {
  const router = new Router<AppState>({ prefix: '/auth' })
  const { auth } = c.services

  // 注册
  router.post('/register', async (ctx) => {
    const req = registerRequestSchema.parse(ctx.request.body)
    ctx.status = 201
    ctx.body = await auth.register(req)
  })

  // 登录
  router.post('/login', async (ctx) => {
    const req = loginRequestSchema.parse(ctx.request.body)
    ctx.body = await auth.login(req)
  })

  // 当前用户
  router.get('/me', c.requireAuth, async (ctx) => {
    const p = requirePrincipal(ctx.state)
    const user = await c.models.users.findById(p.uid)
    if (!user) {
      ctx.status = 404
      return
    }
    ctx.body = toPublicUser(user)
  })

  return router
}
