import type { AppMiddleware } from '../http/state.js'
import type { AuthService } from '../services/domain/auth.service.js'
import { unauthorized } from '../errors.js'

/**
 * 鉴权中间件工厂。校验 Bearer token → 填 ctx.state.user。
 * 显式挂在需要登录的路由前（保持简单，非关键路径）。
 */
export function requireAuth(authService: AuthService): AppMiddleware {
  return async (ctx, next) => {
    const header = ctx.get('authorization')
    const match = /^Bearer\s+(.+)$/i.exec(header)
    if (!match) throw unauthorized('缺少 Bearer token')
    const claims = authService.verifyToken(match[1]!)
    ctx.state.user = { uid: claims.uid, role: claims.role }
    await next()
  }
}
