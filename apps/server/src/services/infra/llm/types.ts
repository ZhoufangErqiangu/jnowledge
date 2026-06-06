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

/**
 * 思考（thinking/CoT）控制。归一化、供应商无关——调用方只声明 tier、不知背后是哪个供应商，
 * 故此处只给可移植词汇，由各 provider class 映射到自己的原生参数（不支持的旋钮静默忽略）。
 * - boolean：true=开（默认强度），false=显式关，省略=随模型默认
 * - effort：归一化强度（low/medium/high），可移植的默认旋钮
 * - budgetTokens：精确思考预算（token 上限），支持的供应商优先用
 */
export type ThinkingEffort = 'low' | 'medium' | 'high'
export type Thinking = boolean | { effort?: ThinkingEffort; budgetTokens?: number }

/** normalizeThinking 的产物：boolean 糖已脱去。mode 三态由各 provider 自行决定如何映射。 */
export interface NormalizedThinking {
  /** default=未指定（随模型默认）；off=显式关；on=显式开。 */
  mode: 'default' | 'off' | 'on'
  effort?: ThinkingEffort
  budgetTokens?: number
}

/** 把 Thinking 归一化：省略→default，false→off，true/对象→on（对象含可选微调）。 */
export function normalizeThinking(t: Thinking | undefined): NormalizedThinking {
  if (t === undefined) return { mode: 'default' }
  if (t === false) return { mode: 'off' }
  if (t === true) return { mode: 'on' }
  const out: NormalizedThinking = { mode: 'on' }
  if (t.effort !== undefined) out.effort = t.effort
  if (t.budgetTokens !== undefined) out.budgetTokens = t.budgetTokens
  return out
}

export interface TextOptions {
  prompt?: string
  system?: string
  messages?: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /**
   * 思考链（thinking/CoT）控制。默认关，由调用层每次传入、一路透传到 provider。
   * 开启时 textStream 会分出 reasoning 两路；text() 仅返回最终答案（丢弃推理过程）。
   */
  thinking?: Thinking
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
 * - tool_calls：本轮模型决定调的工具（finish_reason==='tool_calls' 时累积完整后一次性 yield）；
 * - usage：本次调用的 token 用量（开 stream_options.include_usage 时，流末一次性 yield；供应商不支持则缺省）。
 */
export type AgentChunk =
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; usage: LlmUsage }

export interface GenerateOptions {
  messages: AgentTurnMessage[]
  tools: ToolSpec[]
  thinking?: Thinking
  temperature?: number
  maxTokens?: number
}

/**
 * ① chat provider 契约：一个具体供应商（如 DeepSeek）实现这组能力（见 providers/）。
 * 抽象在此声明，实现按供应商各自写 class——不再走「OpenAI 兼容」的统一适配器，换取最大控制力。
 * zod 是结构化输出的单一真相源（z.infer 类型 + 转 JSON Schema + 运行期校验）。
 */
export interface LLMCapability {
  text(opts: TextOptions): Promise<string>
  textStream(opts: TextOptions): AsyncIterable<StreamChunk>
  object<T>(schema: z.ZodType<T>, opts: ObjectOptions): Promise<T>
  /** ReAct tool-calling 原语：流式产 reasoning/text，并在模型决定调工具时产 tool_calls。 */
  generateStream(opts: GenerateOptions): AsyncIterable<AgentChunk>
}

/** embedding provider 契约：按供应商各自实现（见 providers/）。 */
export interface Embedder {
  /** 文本向量化。model 可覆盖默认模型。返回与输入等长、按输入次序的向量数组。 */
  embed(input: string | string[], model?: string): Promise<number[][]>
}

/** rerank provider 契约：按供应商各自实现（见 providers/）。 */
export interface Reranker {
  /** 重排。返回命中的下标 + 分数，长度 ≤ topN。 */
  rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]>
}

/**
 * ② 三领域 service。LLM 能力按领域拆分，各自独立配置/可用态：
 *   - chat：tier→模型→供应商三层路由（见 chat.ts）
 *   - embedding / rerank：各自一侧供应商的全局能力
 * 与 config.llm.{chat,embedding,rerank} 一一对应。
 */

/** chat 领域：按成本层级取 chat 能力句柄。 */
export interface ChatService {
  /** 取某成本层级对应的 chat 能力句柄（内部走 tier→模型→供应商三层路由）。 */
  tier(tier: LlmTier): LLMCapability
  /** chat 侧是否已配置可用供应商。 */
  readonly configured: boolean
}

/** embedding 领域：文本向量化。 */
export interface EmbeddingService {
  /** 文本向量化。返回与输入等长的向量数组。 */
  embed(input: string | string[], opts?: EmbedOptions): Promise<number[][]>
  /** 是否已配置可用供应商。 */
  readonly configured: boolean
  /** 当前 embedding 模型名与维度（写库 unique(chunk_id, model) 与建表维度用）。 */
  readonly model: string
  readonly dim: number
}

/** rerank 领域：重排（Jina 形状）。 */
export interface RerankService {
  /** 重排。返回命中的下标 + 分数，长度 ≤ topN。 */
  rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]>
  /** 是否已配置可用供应商。 */
  readonly configured: boolean
}

/** 三领域 service 聚合。业务按领域取用：llm.chat / llm.embedding / llm.rerank。 */
export interface LLMClient {
  chat: ChatService
  embedding: EmbeddingService
  rerank: RerankService
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
