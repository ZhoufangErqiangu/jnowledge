import { z } from 'zod'
import { AGENT_RUN_STATUSES, AGENT_STEP_KINDS, MAIN_REASONING_TIERS } from '../constants/enums.js'
import { isoDateSchema, uuidSchema } from './common.js'
import { citationSchema, type Citation } from './chat.js'

/**
 * 四期 Agent：一次 agent 运行（run）+ 其执行轨迹（steps）。
 * run 复用 conversations/messages：终答落 messages，轨迹落 agent_runs/agent_steps。
 */
export const agentRunSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  /** 终答 assistant 消息 id；run 完成回填，未完成为 null。 */
  messageId: uuidSchema.nullable(),
  /** 运行的 agent 名（本期代码定义，如 knowledge_assistant）。 */
  agentName: z.string(),
  status: z.enum(AGENT_RUN_STATUSES),
  input: z.string(),
  error: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})
export type AgentRun = z.infer<typeof agentRunSchema>

/** 一步轨迹：调一次工具/子 agent 的入参与结果（append-only）。 */
export const agentStepSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  seq: z.number().int().nonnegative(),
  kind: z.enum(AGENT_STEP_KINDS),
  /** 工具/子 agent 名。 */
  name: z.string().nullable(),
  input: z.unknown(),
  output: z.unknown(),
  error: z.string().nullable(),
  createdAt: isoDateSchema,
})
export type AgentStep = z.infer<typeof agentStepSchema>

/** Agent 提问（在已建会话内，与 RAG 的 /ask 并存，互不影响）。 */
export const agentAskRequestSchema = z.object({
  question: z.string().min(1).max(4000),
  /** 主推理档位覆盖（仅作用于顶层推理；缺省用人设 tier）。 */
  tier: z.enum(MAIN_REASONING_TIERS).optional(),
  /** 是否启用主推理 thinking（仅作用于顶层推理；缺省随模型默认）。 */
  thinking: z.boolean().optional(),
})
export type AgentAskRequest = z.infer<typeof agentAskRequestSchema>

/** 让 citationSchema 进入打包产物，并供运行期校验复用。 */
export const agentCitationSchema = citationSchema

/**
 * Agent SSE 事件载荷（前端解析 data: <json>）。是 ChatStreamEvent 的超集：
 * - step_start / tool_result：执行轨迹（与 agent_steps 同形，现场流 + 落库）；
 * - reasoning / token：思考过程 / 最终答复增量（仅最终答复流 token）；
 * - citations：聚合自各工具命中的引用列表；
 * - done：结束（终答 message id + run id）；error：错误。
 */
export type AgentStreamEvent =
  | { type: 'step_start'; seq: number; kind: 'tool' | 'agent'; name: string; input: unknown }
  | { type: 'tool_result'; seq: number; ok: boolean; summary: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'token'; delta: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'done'; messageId: string; runId: string }
  | { type: 'error'; message: string }
