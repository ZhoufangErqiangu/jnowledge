import { ERROR_CODES, ERROR_HTTP_STATUS, type ErrorCode } from '@jnowledge/shared'

/**
 * 应用层统一错误。service/controller 一律抛 AppError，
 * 全局错误中间件据 code 映射 HTTP 状态码并整形响应。
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code)
    this.name = 'AppError'
    this.code = code
    this.status = ERROR_HTTP_STATUS[code]
    if (details !== undefined) this.details = details
  }
}

// 常用构造快捷方式
export const notFound = (code: ErrorCode, message?: string) => new AppError(code, message)
export const forbidden = (message = '无权访问') => new AppError(ERROR_CODES.FORBIDDEN, message)
export const unauthorized = (message = '未认证') =>
  new AppError(ERROR_CODES.UNAUTHORIZED, message)
export const conflict = (code: ErrorCode, message?: string) => new AppError(code, message)
export const validation = (message: string, details?: unknown) =>
  new AppError(ERROR_CODES.VALIDATION, message, details)
