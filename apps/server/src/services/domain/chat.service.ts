import { uuidv7 } from 'uuidv7'
import {
  ERROR_CODES,
  type Conversation,
  type ConversationDetail,
  type CreateConversationRequest,
} from '@jnowledge/shared'
import type { Models } from '../../models/index.js'
import { toContextItemDebug } from './agent/projection.js'
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
  removeConversation(p: Principal, conversationId: string): Promise<void>
}

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
      // 完全对称（DESIGN §8.9 阶段 4）：下发原始上下文 + run 树，前端跑共享投影派生视图；不再投影成 Message[]。
      const cv = await loadWithAccess(p, conversationId, 'viewer')
      const rows = await models.contextItems.listByConversation(conversationId)
      const runs = (await models.agentRuns.listByConversation(conversationId)).map((r) => ({
        id: r.id,
        parentRunId: r.parent_run_id,
        agentName: r.agent_name,
        status: r.status,
      }))
      return {
        conversation: toConversation(cv),
        raw: rows.map(toContextItemDebug),
        runs,
      }
    },

    async removeConversation(p, conversationId) {
      await loadWithAccess(p, conversationId, 'viewer')
      await models.conversations.softDelete(conversationId)
    },
  }
}
