import { ZodError } from 'zod'
import { ERROR_CODES, ERROR_HTTP_STATUS, type ErrorResponse } from '@jnowledge/shared'
import type { AppMiddleware } from '../http/state.js'
import type { Logger } from '../logger.js'
import { AppError } from '../errors.js'

/** 全局错误处理：AppError / ZodError / 未知错误统一整形为 ErrorResponse。 */
export function errorHandler(logger: Logger): AppMiddleware {
  return async (ctx, next) => {
    try {
      await next()
    } catch (err) {
      const body = toErrorResponse(err)
      const status = resolveStatus(err)
      ctx.status = status
      ctx.body = body
      const log = logger.child({ requestId: ctx.state.requestId })
      if (status >= 500) log.error({ err }, body.error.message)
      else log.warn({ code: body.error.code }, body.error.message)
    }
  }
}

function resolveStatus(err: unknown): number {
  if (err instanceof AppError) return err.status
  if (err instanceof ZodError) return ERROR_HTTP_STATUS[ERROR_CODES.VALIDATION]
  return ERROR_HTTP_STATUS[ERROR_CODES.INTERNAL]
}

function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    }
  }
  if (err instanceof ZodError) {
    return {
      error: {
        code: ERROR_CODES.VALIDATION,
        message: '请求参数校验失败',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    }
  }
  return { error: { code: ERROR_CODES.INTERNAL, message: '服务器内部错误' } }
}
