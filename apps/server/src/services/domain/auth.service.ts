import { JWT } from '@liuhlightning/jwt'
import { hash as bcryptHash, verify as bcryptVerify } from '@liuhlightning/bcrypt'
import { uuidv7 } from 'uuidv7'
import {
  ERROR_CODES,
  type AuthResponse,
  type JwtClaims,
  type LoginRequest,
  type RegisterRequest,
} from '@jnowledge/shared'
import type { Config } from '../../config/index.js'
import type { UserRepo, UserRow } from '../../models/user.repo.js'
import { toPublicUser } from '../../models/mappers.js'
import { AppError } from '../../errors.js'

export interface AuthDeps {
  config: Config
  users: UserRepo
}

export interface AuthService {
  register(req: RegisterRequest): Promise<AuthResponse>
  login(req: LoginRequest): Promise<AuthResponse>
  /** 中间件用：校验 token，返回 claims；失败抛 AppError。 */
  verifyToken(token: string): JwtClaims
}

export function createAuthService(deps: AuthDeps): AuthService {
  const { config, users } = deps
  // 单 HS256 密钥，一期不做 refresh token。
  const jwt = new JWT(config.auth.jwtSecret, { algorithm: 'HS256' })

  function issue(user: UserRow): AuthResponse {
    const claims: JwtClaims = { uid: user.id, role: user.role }
    const token = jwt.sign(claims, {
      subject: user.id,
      issuedAt: jwt.now,
      expirationTime: jwt.now + config.auth.jwtTtlSeconds,
    })
    return { token, user: toPublicUser(user) }
  }

  return {
    async register(req) {
      // 一期固定验证码（环境变量指定），后续期次换真实验证码服务。
      if (req.captcha !== config.auth.registerCaptcha) {
        throw new AppError(ERROR_CODES.INVALID_CAPTCHA, '验证码错误')
      }

      const existing = await users.findByEmail(req.email)
      if (existing) throw new AppError(ERROR_CODES.EMAIL_TAKEN, '该邮箱已注册')

      // bcrypt 为纯 JS 实现，慢是故意的安全特性（工作因子），勿调低 cost。
      const passwordHash = bcryptHash(req.password, config.auth.bcryptCost)
      const user = await users.insert({
        id: uuidv7(),
        email: req.email,
        passwordHash,
        displayName: null,
      })
      return issue(user)
    },

    async login(req) {
      const user = await users.findByEmail(req.email)
      // 不区分"用户不存在/密码错误"，避免邮箱枚举。
      if (!user || !bcryptVerify(req.password, user.password_hash)) {
        throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, '邮箱或密码错误')
      }
      if (user.status !== 'active') {
        throw new AppError(ERROR_CODES.FORBIDDEN, '账号已禁用')
      }
      return issue(user)
    },

    verifyToken(token) {
      try {
        const payload = jwt.verify<JwtClaims & { sub?: string }>(token)
        return { uid: payload.uid, role: payload.role }
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        const expired = /exp/i.test(message)
        throw new AppError(
          expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.UNAUTHORIZED,
          expired ? 'token 已过期' : 'token 无效',
        )
      }
    },
  }
}
