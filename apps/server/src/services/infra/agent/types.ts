import type { z } from 'zod'
import type { Citation, LlmTier } from '@jnowledge/shared'
import type { Logger } from '../../../logger.js'
import type { LLMClient, ToolSpec } from '../llm/types.js'

/** 工具/子 agent 执行结果。 */
export interface ToolResult {
  ok: boolean
  /** 回喂模型的工具输出（序列化进 tool 消息）。 */
  output: unknown
  /** 给前端/落库的人读摘要。 */
  summary: string
  /** 工具命中的引用（如 knowledge_search）；runtime 经 ctx.citations 聚合。 */
  citations?: Citation[]
  error?: string
}

/**
 * 工具 = 知识库能力的最小单元 / 一整条流水线封装。
 * paramsSchema 复用 zod：转 JSON Schema 喂模型 + 调 handler 前校验 LLM 回填参数。
 */
export interface Tool {
  name: string
  description: string
  paramsSchema: z.ZodType
  tier?: LlmTier
  handler: (args: unknown, ctx: RunContext) => Promise<ToolResult>
}

/** 唯一工具注册表（组合根构建）；agent 按 toolNames「授予」可见子集。 */
export interface ToolRegistry {
  get(name: string): Tool | undefined
  /** 把被授予的工具名转成喂给模型的 ToolSpec（含 JSON Schema 参数）。 */
  specsFor(names: string[]): ToolSpec[]
}

/** 代码定义的 agent（本期不做 CRUD 实体）。 */
export interface AgentDef {
  name: string
  description: string
  system: string
  tier: LlmTier
  /** 被授予的工具名（含 agent-as-tool）。 */
  toolNames: string[]
  /** 最大步数熔断（默认 DEFAULT_MAX_STEPS）。 */
  maxSteps?: number
}

/** 一次 run 的上下文（含熔断预算与可变引用聚合器）。 */
export interface RunContext {
  collectionId: string
  /** agent-as-tool 递归深度（防无限递归，配合 MAX_AGENT_DEPTH）。 */
  depth: number
  /** wall-clock 熔断的截止时间戳（ms）。 */
  deadline: number
  /** 近似 token 预算（按累计字符数估算）的字符上限。 */
  charBudget: number
  signal: AbortSignal
  registry: ToolRegistry
  llm: LLMClient
  logger: Logger
  /** 全 run 共享的引用聚合器；工具向其追加并分配全局 marker。 */
  citations: Citation[]
}

/** runtime 产出的事件（service 翻成 AgentStreamEvent 并落 agent_steps）。 */
export type AgentEvent =
  | { type: 'step_start'; seq: number; kind: 'tool' | 'agent'; name: string; input: unknown }
  | {
      type: 'tool_result'
      seq: number
      kind: 'tool' | 'agent'
      name: string
      ok: boolean
      summary: string
      output: unknown
      error?: string
    }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'final'; answer: string }
  | { type: 'error'; message: string }

/** 默认最大步数（ReAct 循环硬上限）。 */
export const DEFAULT_MAX_STEPS = 8
/** agent-as-tool 最大递归深度。 */
export const MAX_AGENT_DEPTH = 3
