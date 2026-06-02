import type { AppMiddleware } from '../http/state.js'
import type { Logger } from '../logger.js'

/** 请求访问日志（方法/路径/状态/耗时）。 */
export function requestLog(logger: Logger): AppMiddleware {
  return async (ctx, next) => {
    const start = process.hrtime.bigint()
    await next()
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    logger.info(
      {
        requestId: ctx.state.requestId,
        method: ctx.method,
        path: ctx.path,
        status: ctx.status,
        ms: Math.round(ms),
      },
      'request',
    )
  }
}
