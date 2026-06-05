import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * 配置的唯一真相源。两路来源各司其职：
 * - 密钥（DATABASE_URL/JWT_SECRET/S3 密钥/各 LLM apiKey）走环境变量；
 * - LLM 路由表（providers/models/tiers/embedding/rerank 的非密钥部分）走 config.json，
 *   路径由 LLM_CONFIG_PATH 指定（默认 apps/server/config.json），不同环境换文件即可。
 *   config.json 里每个供应商用 apiKeyEnv 声明它的密钥读哪个环境变量——密钥键名也由配置控制。
 * 两路合并后经 zod 校验，以强类型 Config 注入容器；业务代码永不直接碰 process.env / 文件。
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
   * LLM 三层路由（chat 侧）——此为「已解析」形态（apiKey 已从环境变量注入）。
   * 原始路由表来自 config.json（见 llmFileSchema），下方各字段由 loadLlmRouting 合并密钥后产出：
   *   ① tier → 模型逻辑名（tiers）
   *   ② 模型逻辑名 → 注册表项 {provider, model 真实 id}（models）
   *   ③ 模型的 provider → 连接信息 + kind，kind 决定实例化哪个 provider class（providers）
   * 业务只声明 tier；换模型改 tiers，换供应商改 models[*].provider，接新供应商加 provider.kind + 一个 class。
   * embedding + rerank 仍是 SiliconFlow 全局能力（不走上面三层）。无 key 时对应能力为未配置态。
   */
  llm: z.object({
    /** chat 侧三层路由（providers/models/tiers）。embedding/rerank 为同级、不走此三层。 */
    chat: z.object({
      /** ③ 供应商连接表：key=供应商逻辑名，kind 决定第三层路由到哪套处理函数。 */
      providers: z.record(
        z.string(),
        z.object({
          /** 供应商实现判别；值对应一个 provider class。新增供应商在此扩枚举 + 写 class + providerRegistry 加 case。 */
          kind: z.enum(['deepseek', 'siliconflow']).default('deepseek'),
          apiKey: z.string().optional(),
          baseUrl: z.string(),
          /**
           * thinking 开关在请求体里的字段名（仅 kind=openai 用；DeepSeek v4 混合模型）。
           * 如官方参数名变更，仅改此处 + DeepSeekChatProvider.thinkingBody 形状。
           */
          thinkingField: z.string().default('thinking'),
        }),
      ),
      /** ② 模型注册表：key=模型逻辑名，provider 指向 providers，model 是供应商侧真实模型 id。 */
      models: z.record(
        z.string(),
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      /** ① tier→模型逻辑名（值须是 models 的 key）。是否开 thinking 由调用层每次决定，不进此表。 */
      tiers: z.object({
        heavy: z.string(),
        standard: z.string(),
        light: z.string(),
        nano: z.string(),
      }),
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

/**
 * config.json 里 LLM 路由表的形态（「未解析」：不含密钥，只含 apiKeyEnv 指向密钥所在环境变量名）。
 * 与 configSchema.llm 的差异仅在密钥：这里是 apiKeyEnv（字符串名），那里是 apiKey（已注入的值）。
 */
const llmFileSchema = z.object({
  chat: z.object({
    providers: z.record(
      z.string(),
      z.object({
        kind: z.enum(['deepseek', 'siliconflow']).default('deepseek'),
        /** 该供应商密钥读哪个环境变量（密钥键名由配置控制）。 */
        apiKeyEnv: z.string().min(1),
        baseUrl: z.string(),
        thinkingField: z.string().default('thinking'),
      }),
    ),
    models: z.record(z.string(), z.object({ provider: z.string(), model: z.string() })),
    tiers: z.object({
      heavy: z.string(),
      standard: z.string(),
      light: z.string(),
      nano: z.string(),
    }),
  }),
  embedding: z.object({
    apiKeyEnv: z.string().min(1),
    baseUrl: z.string(),
    model: z.string(),
    dim: z.coerce.number().int().positive().default(1024),
  }),
  rerank: z.object({
    apiKeyEnv: z.string().min(1),
    baseUrl: z.string(),
    model: z.string(),
  }),
})

/** LLM_CONFIG_PATH 指定的路径：绝对路径直接用，相对路径相对 cwd；未指定时默认包内 config.json。 */
function resolveLlmConfigPath(envPath?: string): string {
  const trimmed = envPath?.trim()
  if (trimmed) return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed)
  // 默认锚定到包根（apps/server/config.json），与 loadEnv 锚定 .env 的方式一致。
  return fileURLToPath(new URL('../../config.json', import.meta.url))
}

/**
 * 读取 config.json 的 LLM 路由表 + 从环境变量注入密钥，产出 configSchema.llm 期望的「已解析」对象。
 * 文件顶层可直接是路由表，也可包一层 { "llm": ... }（前向兼容未来扩展）。
 */
function loadLlmRouting(env: NodeJS.ProcessEnv): unknown {
  const path = resolveLlmConfigPath(env.LLM_CONFIG_PATH)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(
      `无法读取 LLM 配置文件 ${path}（用 LLM_CONFIG_PATH 指定路径）：${(err as Error).message}`,
    )
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    throw new Error(`LLM 配置文件 ${path} 非合法 JSON：${(err as Error).message}`)
  }
  const routing = (json as { llm?: unknown }).llm ?? json
  const file = llmFileSchema.safeParse(routing)
  if (!file.success) {
    const issues = file.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`LLM 配置文件 ${path} 校验失败：\n${issues}`)
  }
  const f = file.data
  const secret = (name: string): string | undefined => env[name]
  return {
    chat: {
      providers: Object.fromEntries(
        Object.entries(f.chat.providers).map(([key, p]) => [
          key,
          { kind: p.kind, apiKey: secret(p.apiKeyEnv), baseUrl: p.baseUrl, thinkingField: p.thinkingField },
        ]),
      ),
      models: f.chat.models,
      tiers: f.chat.tiers,
    },
    embedding: {
      apiKey: secret(f.embedding.apiKeyEnv),
      baseUrl: f.embedding.baseUrl,
      model: f.embedding.model,
      dim: f.embedding.dim,
    },
    rerank: {
      apiKey: secret(f.rerank.apiKeyEnv),
      baseUrl: f.rerank.baseUrl,
      model: f.rerank.model,
    },
  }
}

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
    // LLM 路由表来自 config.json（密钥从环境变量按 apiKeyEnv 注入）。
    llm: loadLlmRouting(env),
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
