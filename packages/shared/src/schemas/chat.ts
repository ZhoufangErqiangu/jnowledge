import { z } from 'zod'
import { MESSAGE_ROLES } from '../constants/enums.js'
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
  citations: z.array(citationSchema),
  createdAt: isoDateSchema,
})
export type Message = z.infer<typeof messageSchema>

export const conversationSchema = z.object({
  id: uuidSchema,
  /** 绑定的知识库 id；为 null 表示全局会话（仅 agent 模式，跨库检索）。 */
  collectionId: uuidSchema.nullable(),
  title: z.string(),
  createdBy: uuidSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})
export type Conversation = z.infer<typeof conversationSchema>

/**
 * 新建会话。指定 collectionId → 知识库会话（RAG + 库内 agent）；
 * 省略 collectionId → 全局会话（仅 agent，跨库检索）。标题可选，缺省由首条提问生成。
 */
export const createConversationRequestSchema = z.object({
  collectionId: uuidSchema.optional(),
  title: z.string().min(1).max(200).optional(),
})
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>

/** 提问（在已建会话内）。 */
export const askRequestSchema = z.object({
  question: z.string().min(1).max(4000),
})
export type AskRequest = z.infer<typeof askRequestSchema>

/** 会话详情：会话 + 全部消息。 */
export const conversationDetailSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(messageSchema),
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
