import { uuidv7 } from 'uuidv7'
import {
  ERROR_CODES,
  type ContextDebug,
  type Conversation,
  type ConversationDetail,
  type CreateConversationRequest,
} from '@jnowledge/shared'
import type { Models } from '../../models/index.js'
import { projectForChat, projectForUser, toContextItemView } from '../infra/agent/index.js'
import { toConversation } from '../../models/mappers.js'
import type { CollectionService, Principal } from './collection.service.js'
import { AppError } from '../../errors.js'

export interface ChatDeps {
  models: Models
  collectionService: CollectionService
}

export interface ChatService {
  createConversation(p: Principal, req: CreateConversationRequest): Promise<Conversation>
  /** 我的会话列表（统一为全局 agent 会话；库内 RAG 问答已退役）。 */
  listConversations(p: Principal): Promise<Conversation[]>
  getConversation(p: Principal, conversationId: string): Promise<ConversationDetail>
  /** 调试：原始上下文（context_items 全量）+ 派生的推理视图 / 用户视图。 */
  getContextDebug(p: Principal, conversationId: string): Promise<ContextDebug>
  removeConversation(p: Principal, conversationId: string): Promise<void>
}

/** 跨轮历史投影进 LLM 上下文的字符预算（调试推理视图复用）。 */
const HISTORY_CHAR_BUDGET = 60_000

export function createChatService(deps: ChatDeps): ChatService {
  const { models, collectionService } = deps

  async function loadWithAccess(p: Principal, conversationId: string, minRole: 'viewer' | 'editor') {
    const cv = await models.conversations.findById(conversationId)
    if (!cv) throw new AppError(ERROR_CODES.NOT_FOUND, '会话不存在')
    if (cv.collection_id) {
      // 历史遗留的库内会话：仍按库权限校验。
      await collectionService.assertRole(p, cv.collection_id, minRole)
    } else if (cv.created_by !== p.uid && p.role !== 'admin') {
      // 全局会话：仅创建者（或 admin）可访问。
      throw new AppError(ERROR_CODES.FORBIDDEN, '无权访问该会话')
    }
    return cv
  }

  return {
    async createConversation(p, req) {
      // 会话统一为全局（不绑库）：库内 RAG 问答已退役，知识库检索改走 /search 与 agent。
      const row = await models.conversations.insert({
        id: uuidv7(),
        collectionId: null,
        title: req.title ?? '新会话',
        createdBy: p.uid,
      })
      return toConversation(row)
    },

    async listConversations(p) {
      const rows = await models.conversations.listGlobal(p.uid)
      return rows.map(toConversation)
    },

    async getConversation(p, conversationId) {
      const cv = await loadWithAccess(p, conversationId, 'viewer')
      const items = await models.contextItems.listByConversation(conversationId)
      return {
        conversation: toConversation(cv),
        messages: projectForUser(items.map(toContextItemView)),
      }
    },

    async getContextDebug(p, conversationId) {
      // system prompt 审计忠实（DESIGN §8.2）：实际发送值随轮快照落库（internal, stage=system），
      // 此处直接读快照——不重算重建（assembler/模板是会迭代的代码，重算会随版本漂移）。
      const cv = await loadWithAccess(p, conversationId, 'viewer')
      // 原始上下文：context_items 全量、全序、未过滤（含 meta/flags）。
      const rows = await models.contextItems.listByConversation(conversationId)
      const views = rows.map(toContextItemView)
      // run 树：本会话全部 run（含 parentRunId），前端据此把 raw 按 run 分组、表达父子。
      const runs = (await models.agentRuns.listByConversation(conversationId)).map((r) => ({
        id: r.id,
        parentRunId: r.parent_run_id,
        agentName: r.agent_name,
        status: r.status,
      }))
      // systemView：读已落库的 system 输入快照（忠实于发送当时）。run_id 标签取自 run 树。
      // 含稳定前缀（stage=system）与易变作用域后缀（stage=scope），按落库序保持「前缀在前」。
      const runAgentName = new Map(runs.map((r) => [r.id, r.agentName]))
      const systemView = rows
        .filter((r) => r.meta?.stage === 'system' || r.meta?.stage === 'scope')
        .map((r) => ({
          runId: r.run_id,
          label: r.run_id ? (runAgentName.get(r.run_id) ?? 'agent') : 'agent',
          stage: r.meta?.stage as 'system' | 'scope',
          content: r.content,
        }))
      return {
        conversation: toConversation(cv),
        runs,
        systemView,
        raw: rows.map((r) => ({
          id: r.id,
          conversationId: r.conversation_id,
          runId: r.run_id,
          kind: r.kind,
          content: r.content,
          citations: r.citations ?? [],
          meta: (r.meta ?? {}) as Record<string, unknown>,
          flags: r.flags ?? { state: 'active' },
          createdAt: r.created_at.toISOString(),
        })),
        // 推理视图：投影引擎从原始上下文派生的跨轮历史（user/assistant 文本）。
        llmView: projectForChat(views, HISTORY_CHAR_BUDGET),
        // 用户视图：前端可见聊天记录。
        userView: projectForUser(rows.map(toContextItemView)),
      }
    },

    async removeConversation(p, conversationId) {
      await loadWithAccess(p, conversationId, 'viewer')
      await models.conversations.softDelete(conversationId)
    },
  }
}
