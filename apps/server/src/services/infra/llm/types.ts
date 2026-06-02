import type { z } from 'zod'
import type { LlmTier } from '@jnowledge/shared'

/** 单次调用的 token 用量（成本归因用）。 */
export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TextOptions {
  prompt?: string
  system?: string
  messages?: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /**
   * 是否开启思考链（thinking/CoT）。默认关。由调用层每次决定，不进 tier 配置。
   * 开启时 textStream 会分出 reasoning 两路；text() 仅返回最终答案（丢弃推理过程）。
   */
  thinking?: boolean
  /** 覆盖默认模型（一般不用，tier 已绑模型） */
  model?: string
}

export interface ObjectOptions extends TextOptions {
  /** 校验失败回喂重试的最大次数 */
  maxRepairAttempts?: number
}

export interface EmbedOptions {
  model?: string
}

/** textStream 的分段：thinking 开时 reasoning 与正文分两路 yield。 */
export interface StreamChunk {
  type: 'reasoning' | 'text'
  delta: string
}

/** rerank 命中：documents 中的下标 + 相关性分（降序由调用方决定）。 */
export interface RerankHit {
  index: number
  score: number
}

/** 工具描述符（喂给 function-calling；parameters 为 JSON Schema）。 */
export interface ToolSpec {
  name: string
  description: string
  parameters: unknown
}

/** 模型回填的一次工具调用（arguments 已 JSON.parse）。 */
export interface ToolCall {
  id: string
  name: string
  arguments: unknown
}

/**
 * ReAct 循环的历史消息。比 ChatMessage 多 assistant 的 toolCalls 与 tool 角色，
 * 仅 agent 路径（generateStream）用；text/textStream/object 仍用 ChatMessage。
 */
export type AgentTurnMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

/**
 * generateStream 的增量分段：
 * - reasoning/text：思考/正文 token；
 * - tool_calls：本轮模型决定调的工具（finish_reason==='tool_calls' 时累积完整后一次性 yield）。
 */
export type AgentChunk =
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_calls'; calls: ToolCall[] }

export interface GenerateOptions {
  messages: AgentTurnMessage[]
  tools: ToolSpec[]
  thinking?: boolean
  temperature?: number
  maxTokens?: number
}

/**
 * ① 能力层（chat 侧）：所有 chat 供应商收敛到这一组能力。
 * zod 是结构化输出的单一真相源（z.infer 类型 + 转 JSON Schema + 运行期校验）。
 * embed / rerank 属供应商全局能力，提到 LLMClient 顶层，不在 tier 句柄上。
 */
export interface LLMCapability {
  text(opts: TextOptions): Promise<string>
  textStream(opts: TextOptions): AsyncIterable<StreamChunk>
  object<T>(schema: z.ZodType<T>, opts: ObjectOptions): Promise<T>
  /** ReAct tool-calling 原语：流式产 reasoning/text，并在模型决定调工具时产 tool_calls。 */
  generateStream(opts: GenerateOptions): AsyncIterable<AgentChunk>
}

/**
 * ② 层级路由 + 供应商全局能力。
 * 业务只声明 tier，tier→模型绑定集中在配置；embed/rerank 走另一侧供应商（SiliconFlow）。
 */
export interface LLMClient {
  /** 取某成本层级对应的 chat 能力句柄。 */
  tier(tier: LlmTier): LLMCapability
  /** 文本向量化（embedding 供应商）。返回与输入等长的向量数组。 */
  embed(input: string | string[], opts?: EmbedOptions): Promise<number[][]>
  /** 重排（rerank 供应商，Jina 形状）。返回命中的下标 + 分数，长度 ≤ topN。 */
  rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]>
  /** chat 侧是否已配置可用供应商。 */
  readonly configured: boolean
  /** embedding/rerank 侧是否已配置（SiliconFlow key）。 */
  readonly embeddingConfigured: boolean
  /** 当前 embedding 模型名与维度（写库 unique(chunk_id, model) 与建表维度用）。 */
  readonly embeddingModel: string
  readonly embeddingDim: number
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
