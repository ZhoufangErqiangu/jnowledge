import Koa from 'koa'
import cors from '@koa/cors'
import { bodyParser } from '@koa/bodyparser'
import Router from '@koa/router'
import type { Container } from './container.js'
import type { AppState } from './http/state.js'
import { errorHandler } from './middleware/error.js'
import { requestId } from './middleware/requestId.js'
import { requestLog } from './middleware/requestLog.js'
import { registerControllers } from './controllers/index.js'
import { createDocsRouter } from './http/docs.js'

/**
 * 建 Koa app：挂全局中间件 → 健康检查/文档 → 显式注册业务 controller。
 * 注意全局中间件顺序：errorHandler 最外层兜底，bodyParser 在 controller 前。
 */
export function createApp(c: Container): Koa<AppState> {
  const app = new Koa<AppState>()

  app.use(errorHandler(c.logger))
  app.use(requestId())
  app.use(requestLog(c.logger))
  app.use(cors())
  app.use(bodyParser())

  // 健康检查
  const sys = new Router<AppState>()
  sys.get('/health', (ctx) => {
    ctx.body = { status: 'ok', llm: c.infra.llm.configured ? 'configured' : 'unconfigured' }
  })
  app.use(sys.routes())
  app.use(sys.allowedMethods())

  // API 文档
  const docs = createDocsRouter()
  app.use(docs.routes())
  app.use(docs.allowedMethods())

  // 业务 controller（显式注册）
  registerControllers(app, c)

  return app
}
