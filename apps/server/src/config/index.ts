import { z } from 'zod'

/**
 * 环境配置的唯一真相源。所有 process.env 读取集中在此，经 zod 校验后
 * 以强类型 Config 注入容器；业务代码永不直接碰 process.env。
 */
const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().int().positive().default(3000),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  database: z.object({
    url: z.string().min(1, 'DATABASE_URL 必填'),
  }),

  auth: z.object({
    /** JWT HS256 密钥 */
    jwtSecret: z.string().min(16, 'JWT_SECRET 至少 16 位'),
    /** access token 有效期（秒） */
    jwtTtlSeconds: z.coerce.number().int().positive().default(7 * 24 * 3600),
    /** bcrypt cost（纯 JS 实现，慢是故意的安全特性，勿盲目调低） */
    bcryptCost: z.coerce.number().int().min(4).max(31).default(12),
    /** 注册验证码（一期固定码，由环境变量指定） */
    registerCaptcha: z.string().min(1).default('123456'),
  }),

  storage: z.object({
    endpoint: z.string().optional(),
    region: z.string().default('us-east-1'),
    bucket: z.string().default('jnowledge'),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    /** MinIO 等需 path-style 寻址 */
    forcePathStyle: z.coerce.boolean().default(true),
  }),

  /** LLM 一期仅占位，无 key 时能力层处于未配置态（CRUD 闭环不依赖） */
  llm: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().default('https://api.openai.com/v1'),
  }),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    database: { url: env.DATABASE_URL },
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtTtlSeconds: env.JWT_TTL_SECONDS,
      bcryptCost: env.BCRYPT_COST,
      registerCaptcha: env.REGISTER_CAPTCHA,
    },
    storage: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    llm: {
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL,
    },
  })

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`配置校验失败：\n${issues}`)
  }
  return parsed.data
}
