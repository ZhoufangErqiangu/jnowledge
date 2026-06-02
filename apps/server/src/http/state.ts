import type Koa from 'koa'
import type { Principal } from '../services/domain/collection.service.js'

/** 全仓统一的 Koa 中间件类型（绑定 AppState），替代直接命名导入 koa 的命名空间成员。 */
export type AppMiddleware = Koa.Middleware<AppState>

/** Koa ctx.state 形态。中间件填充，controller 读取。 */
export interface AppState {
  requestId: string
  /** 经 auth 中间件校验后的请求者；未认证路由为 undefined。 */
  user?: Principal
}

/** 从 ctx.state 取已认证用户，缺失即编程错误（应被 auth 中间件挡下）。 */
export function requirePrincipal(state: AppState): Principal {
  if (!state.user) throw new Error('requirePrincipal: 路由缺少 auth 中间件')
  return state.user
}
