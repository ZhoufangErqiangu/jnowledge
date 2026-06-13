import { z } from 'zod'
import {
  AGENT_RUN_STATUSES,
  CONTEXT_ITEM_KINDS,
  CONTEXT_ITEM_STATES,
  MESSAGE_ROLES,
} from '../constants/enums.js'
import { isoDateSchema, uuidSchema } from './common.js'

/**
 * 引用溯源：assistant 答案中 [chunk_id] 标记映射回的 chunk 定位信息。
 * 含 char 偏移与 heading_path，前端据此跳原文并高亮（复用一期精确偏移）。
 */
export const citationSchema = z.object({
  /** 答案中引用标记的序号（[1]、[2]…），稳定对应一条 citation。 */
  marker: z.number().int().positive(),
  chunkId: uuidSchema,
  documentId: uuidSchema,
  documentTitle: z.string(),
  versionId: uuidSchema,
  seq: z.number().int().nonnegative(),
  headingPath: z.array(z.string()),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  /** 命中片段摘要（展示用，非全文）。 */
  snippet: z.string(),
})
export type Citation = z.infer<typeof citationSchema>

export const messageSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  role: z.enum(MESSAGE_ROLES),
  content: z.string(),
  /** assistant 轮的思考过程（thinking 开时），仅展示用；不计入 LLM 历史。 */
  reasoning: z.string().optional(),
  citations: z.array(citationSchema),
  createdAt: isoDateSchema,
})
export type Message = z.infer<typeof messageSchema>

export const conversationSchema = z.object({
  id: uuidSchema,
  /** 历史遗留字段：会话已统一为全局 agent 会话，恒为 null（库内 RAG 问答已退役）。 */
  collectionId: uuidSchema.nullable(),
  title: z.string(),
  createdBy: uuidSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})
export type Conversation = z.infer<typeof conversationSchema>

/** 新建会话（统一为全局 agent 会话）。标题可选，缺省由首条提问生成。 */
export const createConversationRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
})
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>

/** 提问（在已建会话内）。 */
export const askRequestSchema = z.object({
  question: z.string().min(1).max(4000),
})
export type AskRequest = z.infer<typeof askRequestSchema>


/**
 * 调试视图：原始上下文（context_items 全量条目，未经投影过滤）。
 * 含 meta/flags——这两者在跨平台契约里本是服务端持久化形状，仅在调试 DTO 里
 * 暴露给前端逐字段渲染（meta 宽松为 record；flags 显式列出已知 flag 字段）。
 */
export const contextItemDebugSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  /** 所属 agent run；RAG 单轮路径为 null。 */
  runId: uuidSchema.nullable(),
  kind: z.enum(CONTEXT_ITEM_KINDS),
  content: z.string(),
  citations: z.array(citationSchema),
  /** assistant 轮含 toolCalls；tool_result 含 seq/name/ok/error/summary/input/output。 */
  meta: z.record(z.string(), z.unknown()),
  flags: z.object({
    state: z.enum(CONTEXT_ITEM_STATES),
    pinned: z.boolean().optional(),
    protected: z.boolean().optional(),
    summarized: z.boolean().optional(),
  }),
  createdAt: isoDateSchema,
})
export type ContextItemDebug = z.infer<typeof contextItemDebugSchema>

/** 推理视图里的一条消息（投影引擎从原始上下文派生，剥离 tool_calls）。 */
export const llmViewMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})
export type LlmViewMessage = z.infer<typeof llmViewMessageSchema>

/**
 * run 树节点：debug 页据 parentRunId 重建「agent → 子 agent」嵌套调用树。
 * 顶层 run 的 parentRunId 为 null；子 run（agentAsTool）指向发起它的父 run。
 */
export const agentRunNodeSchema = z.object({
  id: uuidSchema,
  parentRunId: uuidSchema.nullable(),
  agentName: z.string(),
  status: z.enum(AGENT_RUN_STATUSES),
})
export type AgentRunNode = z.infer<typeof agentRunNodeSchema>

/**
 * 会话详情（DESIGN §8.9，阶段 4 完全对称）：服务端只下发**原始上下文 + run 树**，
 * 前端跑共享投影（projectForUser）派生用户消息、另一投影派生子 agent 参与方泳道——
 * 与 live 流投影同一份 raw，reload 与 live 无法发散。server 不再下发 Message[]。
 */
export const conversationDetailSchema = z.object({
  conversation: conversationSchema,
  /** 原始上下文：context_items 全量、按 (created_at,id) 全序，未过滤（含 internal 子 agent 条目）。 */
  raw: z.array(contextItemDebugSchema),
  /** run 树：本会话全部 agent_runs（含 parentRunId），前端据此重建子 agent 嵌套泳道。 */
  runs: z.array(agentRunNodeSchema),
})
export type ConversationDetail = z.infer<typeof conversationDetailSchema>

/**
 * SSE 事件载荷（前端解析 data: <json>）。type 区分：
 * - token：增量正文；reasoning：思考过程增量（thinking 开时）；
 * - citations：检索引用列表（生成前或末尾一次性下发）；
 * - done：结束（带最终 message id）；error：错误。
 */
export type ChatStreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string }

/**
 * 原始上下文流事件（DESIGN §8.9）：**流式传输 = recorder 每次写入的镜像**。
 * 前端按到达序累积出与 DB 回放同构的 raw 模型（ContextItemView[]），再跑共享投影
 * （projectForUser 等）派生用户视图 / 轨迹 / 子 agent 参与方泳道——live 与 reload 投影同一序列、无法发散。
 *
 * - `item`：一个 context 条目落定（与 ContextItemDebug 同形，含 internal 的子 agent 条目）；
 *   citations 随 assistant 落定条目携带；messageId 即该 item 的 id（旧 citations/done 事件就此退役）。
 * - `patch`：当前未落定条目的增量（落定前的 text / reasoning token）；`runId` 显式标明归属 run（含子 agent）。
 * - `run`：run 树节点（顶层 / 子 agent run 创建时各下发一次），前端据 parentRunId 建嵌套。
 * - `error`：运行失败。
 */
export type RawContextStreamEvent =
  | { type: 'item'; item: ContextItemDebug }
  | { type: 'patch'; runId: string; field: 'text' | 'reasoning'; delta: string }
  | { type: 'run'; node: AgentRunNode }
  | { type: 'error'; message: string }
