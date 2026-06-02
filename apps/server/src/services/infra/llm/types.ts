import type { z } from 'zod'
import type { LlmTier } from '@jnowledge/shared'

/** 单次调用的 token 用量（成本归因用）。 */
export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface TextOptions {
  prompt?: string
  system?: string
  messages?: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** 覆盖默认模型（一般不用，tier 已绑模型） */
  model?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ObjectOptions extends TextOptions {
  /** 校验失败回喂重试的最大次数 */
  maxRepairAttempts?: number
}

export interface EmbedOptions {
  model?: string
}

/**
 * ① 能力层：所有供应商收敛到这一组能力。
 * zod 是结构化输出的单一真相源（z.infer 类型 + 转 JSON Schema + 运行期校验）。
 */
export interface LLMCapability {
  text(opts: TextOptions): Promise<string>
  textStream(opts: TextOptions): AsyncIterable<string>
  object<T>(schema: z.ZodType<T>, opts: ObjectOptions): Promise<T>
  embed(input: string | string[], opts?: EmbedOptions): Promise<number[][]>
}

/**
 * ② 层级路由：业务只声明 tier，tier→模型绑定集中在配置。
 * 一期仅暴露接口；底层目前对所有 tier 用同一默认模型。
 */
export interface LLMClient {
  /** 取某成本层级对应的能力句柄。 */
  tier(tier: LlmTier): LLMCapability
  /** 是否已配置可用供应商（无 key 时为 false，CRUD 闭环不依赖）。 */
  readonly configured: boolean
}

/** 统一错误 taxonomy。 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'provider' | 'validation' | 'unconfigured' = 'provider',
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}
