import { uuidv7 } from 'uuidv7'
import {
  ERROR_CODES,
  type ChatStreamEvent,
  type Citation,
  type ContextDebug,
  type Conversation,
  type ConversationDetail,
  type CreateConversationRequest,
} from '@jnowledge/shared'
import type { Models } from '../../models/index.js'
import type { Infra } from '../infra/index.js'
import type { Logger } from '../../logger.js'
import type { ChatMessage } from '../infra/llm/types.js'
import { projectForChat, projectForUser, toContextItemView } from '../infra/agent/index.js'
import { toConversation } from '../../models/mappers.js'
import type { CollectionService, Principal } from './collection.service.js'
import type { RetrievalService, RetrievedChunk } from './retrieval.js'
import { AppError } from '../../errors.js'

export interface ChatDeps {
  models: Models
  infra: Infra
  logger: Logger
  collectionService: CollectionService
  retrieval: RetrievalService
}

export interface ChatService {
  createConversation(p: Principal, req: CreateConversationRequest): Promise<Conversation>
  listConversations(p: Principal, collectionId: string): Promise<Conversation[]>
  /** 全局会话列表（不绑库，仅 agent 模式）。 */
  listGlobalConversations(p: Principal): Promise<Conversation[]>
  getConversation(p: Principal, conversationId: string): Promise<ConversationDetail>
  /** 调试：原始上下文（context_items 全量）+ 派生的推理视图 / 用户视图。 */
  getContextDebug(p: Principal, conversationId: string): Promise<ContextDebug>
  removeConversation(p: Principal, conversationId: string): Promise<void>
  /** 流式问答：产出 SSE 事件序列；落库 user + assistant 消息。 */
  ask(p: Principal, conversationId: string, question: string): AsyncIterable<ChatStreamEvent>
}

/** 跨轮历史投影进 LLM 上下文的字符预算。 */
const HISTORY_CHAR_BUDGET = 60_000

const GENERATION_SYSTEM = [
  '你是知识库问答助手。只能依据下面提供的「资料」回答用户问题，不得编造资料外的信息。',
  '每条资料以 [序号] 开头。回答时，凡是引用了某条资料的句子，必须在句末用对应的 [序号] 标注来源（可多个，如 [1][3]）。',
  '若资料不足以回答，明确说明「根据现有资料无法回答」，不要臆测。用简洁的中文回答。',
].join('\n')

export function createChatService(deps: ChatDeps): ChatService {
  const { models, infra, logger, collectionService, retrieval } = deps
  const { llm } = infra

  async function loadWithAccess(
    p: Principal,
    conversationId: string,
    minRole: 'viewer' | 'editor',
  ) {
    const cv = await models.conversations.findById(conversationId)
    if (!cv) throw new AppError(ERROR_CODES.NOT_FOUND, '会话不存在')
    if (cv.collection_id) {
      await collectionService.assertRole(p, cv.collection_id, minRole)
    } else if (cv.created_by !== p.uid && p.role !== 'admin') {
      // 全局会话：仅创建者（或 admin）可访问。
      throw new AppError(ERROR_CODES.FORBIDDEN, '无权访问该会话')
    }
    return cv
  }

  /** 把检索命中拼成生成提示里的「资料」块。 */
  function buildContextBlocks(chunks: RetrievedChunk[]): string {
    return chunks
      .map((c) => {
        const where = c.headingPath.length ? `（${c.headingPath.join(' > ')}）` : ''
        return `[${c.marker}] 《${c.documentTitle}》${where}\n${c.context}`
      })
      .join('\n\n')
  }

  /** 解析答案中的 [n] 标记，仅保留确有命中的引用，去重后按 marker 升序。 */
  function validateCitations(answer: string, chunks: RetrievedChunk[]): Citation[] {
    const cited = new Set<number>()
    for (const m of answer.matchAll(/\[(\d+)\]/g)) {
      cited.add(Number(m[1]))
    }
    return chunks
      .filter((c) => cited.has(c.marker))
      .map((c) => ({
        marker: c.marker,
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        versionId: c.versionId,
        seq: c.seq,
        headingPath: c.headingPath,
        charStart: c.charStart,
        charEnd: c.charEnd,
        snippet: c.snippet,
      }))
  }

  async function* ask(
    p: Principal,
    conversationId: string,
    question: string,
  ): AsyncIterable<ChatStreamEvent> {
    let cv
    try {
      cv = await loadWithAccess(p, conversationId, 'viewer')
    } catch (err) {
      yield { type: 'error', message: err instanceof AppError ? err.message : '无权访问会话' }
      return
    }

    // RAG 问答须绑定知识库；全局会话只支持 agent 模式（走 /agent 端点）。
    const collectionId = cv.collection_id
    if (!collectionId) {
      yield { type: 'error', message: '全局会话不支持 RAG 问答，请使用 Agent 模式' }
      return
    }

    try {
      // 历史（本轮提问入库前）作为改写与生成的上下文——经投影引擎从全量日志派生。
      const priorItems = (await models.contextItems.listByConversation(conversationId)).map(
        toContextItemView,
      )
      const history: ChatMessage[] = projectForChat(priorItems, HISTORY_CHAR_BUDGET)

      // 落库用户消息（RAG 单轮路径无 run，run_id 为 null）；首问且标题为占位时用问题生成标题。
      await models.contextItems.insert({
        id: uuidv7(),
        conversationId,
        kind: 'user',
        content: question,
      })
      if (priorItems.length === 0 && cv.title === '新会话') {
        await models.conversations.setTitle(conversationId, truncate(question, 30))
      }

      // 检索：改写 → 完整混合检索。
      const rewritten = await retrieval.rewriteQuery(question, history)
      const chunks = await retrieval.retrieve(collectionId, rewritten)

      // 检索结果写回上下文（tool_result）——使原始上下文自包含：改写后的查询与命中片段
      // 都留痕于全量日志（与 agent 路径的工具结果同构）。投影引擎跨轮不回放 tool_result，
      // projectForUser 亦跳过 → 推理视图 / 用户视图行为不变，仅供调试与审计。
      await models.contextItems.insert({
        id: uuidv7(),
        conversationId,
        kind: 'tool_result',
        // content 存 LLM 本轮实际看到的「资料」块（往返真相源）；结构化 chunks 进 meta.output。
        content: chunks.length > 0 ? buildContextBlocks(chunks) : '（未检索到相关资料）',
        meta: {
          seq: 1,
          name: 'knowledge_search',
          ok: true,
          error: null,
          summary: `检索到 ${chunks.length} 个片段`,
          input: { query: rewritten, collectionId },
          output: chunks,
        },
      })

      // 生成。
      let answer = ''
      if (!llm.chat.configured) {
        // 未配置生成模型：降级为「列出检索片段」，仍可演示检索与引用。
        answer = chunks.length
          ? `（未配置生成模型，以下为检索到的相关片段）\n\n${chunks
              .map((c) => `[${c.marker}] ${c.snippet}`)
              .join('\n')}`
          : '（未配置生成模型，且未检索到相关资料）'
        yield { type: 'token', delta: answer }
      } else {
        const userTurn =
          chunks.length > 0
            ? `资料：\n${buildContextBlocks(chunks)}\n\n问题：${question}`
            : `（知识库未检索到相关资料）\n\n问题：${question}`
        const messages: ChatMessage[] = [...history, { role: 'user', content: userTurn }]
        for await (const part of llm.chat.tier('standard').textStream({
          system: GENERATION_SYSTEM,
          messages,
        })) {
          if (part.type === 'reasoning') {
            yield { type: 'reasoning', delta: part.delta }
          } else {
            answer += part.delta
            yield { type: 'token', delta: part.delta }
          }
        }
      }

      // 引用校验 + 落库 assistant 消息。
      const citations = llm.chat.configured
        ? validateCitations(answer, chunks)
        : chunks.map((c) => toCitation(c))
      yield { type: 'citations', citations }

      const assistant = await models.contextItems.insert({
        id: uuidv7(),
        conversationId,
        kind: 'assistant',
        content: answer,
        citations,
      })
      await models.conversations.touch(conversationId)
      yield { type: 'done', messageId: assistant.id }
    } catch (err) {
      logger.error({ conversationId, err }, 'ask 失败')
      yield { type: 'error', message: err instanceof Error ? err.message : '生成失败' }
    }
  }

  return {
    async createConversation(p, req) {
      // 指定库 → 知识库会话（需 viewer 权限）；省略 → 全局会话（任何登录用户可建）。
      if (req.collectionId) await collectionService.assertRole(p, req.collectionId, 'viewer')
      const row = await models.conversations.insert({
        id: uuidv7(),
        collectionId: req.collectionId ?? null,
        title: req.title ?? '新会话',
        createdBy: p.uid,
      })
      return toConversation(row)
    },

    async listConversations(p, collectionId) {
      await collectionService.assertRole(p, collectionId, 'viewer')
      const rows = await models.conversations.listByCollection(collectionId, p.uid)
      return rows.map(toConversation)
    },

    async listGlobalConversations(p) {
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
      // TODO(可观测性): system prompt 目前是请求时注入的静态常量（GENERATION_SYSTEM /
      // agentDef.system），不入 context_items，故 raw/llmView 都看不到它。待推理流程定型后
      // （system 将动态派生、并可能存在多层嵌套推理）再统一处理 system 与嵌套链路的可观测性，
      // 届时需先回答「system 算原始上下文还是派生逻辑」。暂缓，避免给移动靶子绑死建模。
      const cv = await loadWithAccess(p, conversationId, 'viewer')
      // 原始上下文：context_items 全量、全序、未过滤（含 meta/flags）。
      const rows = await models.contextItems.listByConversation(conversationId)
      const views = rows.map(toContextItemView)
      return {
        conversation: toConversation(cv),
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

    ask,
  }
}

function toCitation(c: RetrievedChunk): Citation {
  return {
    marker: c.marker,
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    versionId: c.versionId,
    seq: c.seq,
    headingPath: c.headingPath,
    charStart: c.charStart,
    charEnd: c.charEnd,
    snippet: c.snippet,
  }
}

function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n)}…`
}
