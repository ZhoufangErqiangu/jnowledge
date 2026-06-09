import type { z } from 'zod'
import type { Citation, LlmTier } from '@jnowledge/shared'
import type { Logger } from '../../../logger.js'
import type { LLMClient, LlmCallStat, ToolCall } from '../llm/types.js'

export type { LlmCallStat }

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
  /**
   * 轨迹类别（缺省 'tool'）：被当作工具调用的子 agent 标 'agent'（见 buildSubAgentTool），
   * 使 step_start/tool_result 事件能区分「调工具」与「切到子 agent 上下文」，前端/调试页据此呈现。
   */
  kind?: 'tool' | 'agent'
  handler: (args: unknown, ctx: RunContext) => Promise<ToolResult>
}

/**
 * 工具目录（catalog）：组合根用全集构建，仅在**构造期**用来按名取被授予子集。
 * 不再进 RunContext、不进运行 loop——agent 构造时已被注入解析好的 Tool[]（见 Agent/AgentConfig）。
 */
export interface ToolRegistry {
  get(name: string): Tool | undefined
  /** 按被授予的工具名取子集（保序，未知名跳过）；交给 Agent 构造期注入。 */
  select(names: string[]): Tool[]
}

/**
 * 代码定义的 agent persona（本期不做 CRUD 实体）：声明「人设 + 被授予的工具名」。
 * toolNames→Tool[] 的解析由组合根/domain 经 ToolRegistry.select 完成，再注入 Agent 构造。
 */
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

/** 作用域天花板：沿 run 树委派、单调收窄。'principal'=principal 全量可访问库；string[]=收窄到指定库集。 */
export interface Scope {
  ceiling: 'principal' | string[]
}

/** 一次 run 的上下文（含熔断预算与可变引用聚合器）。 */
export interface RunContext {
  /**
   * 本 run 的作用域天花板（run 的属性，非 agent 身份；沿 run 树委派、单调收窄）：
   * - 'principal'：可触达 ctx.principal 有权访问的全部库（顶层 agent 恒为此，实权由 assertRole 守）；
   * - string[]：被收窄到指定库集（仅经 agentAsTool 委派产生，子 agent 不可加宽）。
   * 工具按此校验目标库是否越界（见 scope.ts / inCeiling）；越界须显式回报，不得绕过。
   */
  scope: Scope
  /** 请求者身份；全局态工具按其权限校验所选库的访问（结构化，避免 infra 反依赖 domain）。 */
  principal: { uid: string; role: 'admin' | 'user' }
  /** 当前会话 id；写操作两阶段确认据此定位 pending。 */
  conversationId: string
  /** 当前 run id；确认门要求「提案 run ≠ 执行 run」，防同轮自确认绕过。 */
  runId: string
  /** agent-as-tool 递归深度（防无限递归，配合 MAX_AGENT_DEPTH）。 */
  depth: number
  /** wall-clock 熔断的截止时间戳（ms）。 */
  deadline: number
  /** 近似 token 预算（按累计字符数估算）的字符上限。 */
  charBudget: number
  signal: AbortSignal
  llm: LLMClient
  logger: Logger
  /** 全 run 共享的引用聚合器；工具向其追加并分配全局 marker。 */
  citations: Citation[]
}

/** runtime 产出的事件（service 翻成 AgentStreamEvent 并落 context_items）。 */
export type AgentEvent =
  /**
   * 中间 assistant 轮（发起了工具调用）。service 据此落一条 kind=assistant 的 context_item，
   * meta.toolCalls 持久化 toolCalls 供诊断/v2 跨轮重建。终答不走此事件，走 final。
   * llm：本轮那次 LLM 调用的耗时与用量。
   */
  | { type: 'assistant'; content?: string; toolCalls?: ToolCall[]; llm?: LlmCallStat }
  | { type: 'step_start'; seq: number; kind: 'tool' | 'agent'; name: string; input: unknown }
  | {
      type: 'tool_result'
      seq: number
      kind: 'tool' | 'agent'
      name: string
      /** 配对的 assistant.toolCalls[i].id；落 context_items.meta.toolCallId 供无损重建。 */
      toolCallId: string
      ok: boolean
      summary: string
      output: unknown
      error?: string
    }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  /** 终答（无工具调用的末轮）。llm：产出该终答的那次 LLM 调用耗时与用量。 */
  | { type: 'final'; answer: string; llm?: LlmCallStat }
  | { type: 'error'; message: string }

/** 默认最大步数（ReAct 循环硬上限）。 */
export const DEFAULT_MAX_STEPS = 8
/** agent-as-tool 最大递归深度。 */
export const MAX_AGENT_DEPTH = 3
