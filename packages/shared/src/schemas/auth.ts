import { z } from 'zod'
import { USER_ROLES, USER_STATUSES } from '../constants/enums.js'
import { isoDateSchema, uuidSchema } from './common.js'

/** 密码策略：一处定义，注册/改密共用。 */
export const passwordSchema = z
  .string()
  .min(8, '密码至少 8 位')
  .max(128, '密码至多 128 位')

export const registerRequestSchema = z.object({
  email: z.email(),
  password: passwordSchema,
  /** 注册验证码（一期为环境变量指定的固定码） */
  captcha: z.string().min(1, '请输入验证码'),
})
export type RegisterRequest = z.infer<typeof registerRequestSchema>

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

/** 对外暴露的用户（绝不含 password_hash）。 */
export const publicUserSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  displayName: z.string().nullable(),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  createdAt: isoDateSchema,
})
export type PublicUser = z.infer<typeof publicUserSchema>

export const authResponseSchema = z.object({
  token: z.string(),
  user: publicUserSchema,
})
export type AuthResponse = z.infer<typeof authResponseSchema>

/** JWT payload 的私有声明部分（与注册 claims 合并）。 */
export const jwtClaimsSchema = z.object({
  uid: uuidSchema,
  role: z.enum(USER_ROLES),
})
export type JwtClaims = z.infer<typeof jwtClaimsSchema>
