import { randomUUID } from 'node:crypto'
import type { AppMiddleware } from '../http/state.js'

/** 给每个请求分配 id，写入 ctx.state 与响应头，便于日志串联。 */
export function requestId(): AppMiddleware {
  return async (ctx, next) => {
    const id = ctx.get('x-request-id') || randomUUID()
    ctx.state.requestId = id
    ctx.set('x-request-id', id)
    await next()
  }
}
