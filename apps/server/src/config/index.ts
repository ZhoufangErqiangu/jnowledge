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

  /**
   * LLM 分两侧供应商（二期）：
   * - chat/生成 = DeepSeek 官方（OpenAI 兼容），tier→模型在此绑定。
   * - embedding + rerank = SiliconFlow（一个 key，OpenAI 兼容 + Jina 形状 rerank）。
   * 无 key 时对应能力处于未配置态（一期 CRUD 闭环不依赖）。
   */
  llm: z.object({
    chat: z.object({
      apiKey: z.string().optional(),
      baseUrl: z.string().default('https://api.deepseek.com/v1'),
      /** tier→模型：heavy=pro，其余=flash（是否开 thinking 由调用层每次决定）。 */
      models: z.object({
        heavy: z.string().default('deepseek-v4-pro'),
        standard: z.string().default('deepseek-v4-flash'),
        light: z.string().default('deepseek-v4-flash'),
        nano: z.string().default('deepseek-v4-flash'),
      }),
      /**
       * thinking 开关在请求体里的字段名（DeepSeek v4 混合模型唯一待官方最终确认处）。
       * 默认 `thinking`；如官方参数名变更，仅改此一处（+ openaiAdapter.thinkingBody 形状）。
       */
      thinkingField: z.string().default('thinking'),
    }),
    embedding: z.object({
      apiKey: z.string().optional(),
      baseUrl: z.string().default('https://api.siliconflow.cn/v1'),
      model: z.string().default('BAAI/bge-m3'),
      dim: z.coerce.number().int().positive().default(1024),
    }),
    rerank: z.object({
      apiKey: z.string().optional(),
      baseUrl: z.string().default('https://api.siliconflow.cn/v1'),
      model: z.string().default('BAAI/bge-reranker-v2-m3'),
    }),
  }),

  /** RAG 入库与检索可调参数。 */
  rag: z.object({
    /** 入库时是否启用 Contextual Retrieval（每 chunk 生成定位上下文再 embed）。 */
    contextual: z.coerce.boolean().default(true),
    /** Contextual 时喂给 light 模型的文档正文最大字符数（控成本，超出截断）。 */
    contextMaxChars: z.coerce.number().int().positive().default(12000),
    /** 向量召回 topK。 */
    vectorTopK: z.coerce.number().int().positive().default(40),
    /** 全文召回 topK。 */
    ftsTopK: z.coerce.number().int().positive().default(40),
    /** rerank 后保留进上下文的 topK。 */
    rerankTopK: z.coerce.number().int().positive().default(8),
    /** RRF 融合常数（倒数排名 1/(k+rank)）。 */
    rrfK: z.coerce.number().int().positive().default(60),
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
      chat: {
        apiKey: env.DEEPSEEK_API_KEY,
        baseUrl: env.DEEPSEEK_BASE_URL,
        models: {
          heavy: env.LLM_MODEL_HEAVY,
          standard: env.LLM_MODEL_STANDARD,
          light: env.LLM_MODEL_LIGHT,
          nano: env.LLM_MODEL_NANO,
        },
        thinkingField: env.DEEPSEEK_THINKING_FIELD,
      },
      // embedding 与 rerank 同属 SiliconFlow，共用一个 key。
      embedding: {
        apiKey: env.SILICONFLOW_API_KEY,
        baseUrl: env.SILICONFLOW_BASE_URL,
        model: env.EMBEDDING_MODEL,
        dim: env.EMBEDDING_DIM,
      },
      rerank: {
        apiKey: env.SILICONFLOW_API_KEY,
        baseUrl: env.SILICONFLOW_BASE_URL,
        model: env.RERANK_MODEL,
      },
    },
    rag: {
      contextual: env.RAG_CONTEXTUAL,
      contextMaxChars: env.RAG_CONTEXT_MAX_CHARS,
      vectorTopK: env.RAG_VECTOR_TOPK,
      ftsTopK: env.RAG_FTS_TOPK,
      rerankTopK: env.RAG_RERANK_TOPK,
      rrfK: env.RAG_RRF_K,
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
