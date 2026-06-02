import { uuidv7 } from 'uuidv7'
import { ERROR_CODES, type AgentStreamEvent, type Citation } from '@jnowledge/shared'
import type { Models } from '../../models/index.js'
import type { Infra } from '../infra/index.js'
import type { Logger } from '../../logger.js'
import {
  type AgentDef,
  type RunContext,
  createGetDocumentTool,
  createKnowledgeSearchTool,
  createToolRegistry,
  runAgent,
} from '../infra/agent/index.js'
import type { CollectionService, Principal } from './collection.service.js'
import type { RetrievalService, RetrievedChunk } from './retrieval.js'
import { AppError } from '../../errors.js'

export interface AgentDeps {
  models: Models
  infra: Infra
  logger: Logger
  collectionService: CollectionService
  retrieval: RetrievalService
}

export interface AgentService {
  /** Agent 流式问答：ReAct 自主编排检索/读文档；产 SSE 轨迹 + 答复；落 run/steps/message。 */
  ask(p: Principal, conversationId: string, question: string): AsyncIterable<AgentStreamEvent>
}

/** 本期唯一的代码定义 agent（不做 CRUD 实体）。 */
const KNOWLEDGE_ASSISTANT: AgentDef = {
  name: 'knowledge_assistant',
  description: '基于知识库检索回答问题的助手',
  system: [
    '你是知识库智能助手，可调用工具检索知识库来回答用户问题。',
    '- 当问题需要依据知识库内容时，调用 knowledge_search 检索；可多次检索以补充或细化查询。',
    '- 若检索片段不足，可用 get_document 查看某文档更多上下文；仍不足则如实说明「根据现有资料无法回答」，不要臆测。',
    '- 回答时，凡引用了检索资料的句子，必须在句末用对应的 [序号] 标注来源（可多个，如 [1][3]）。',
    '- 闲聊或无需知识库即可回答的问题，直接回答，不必检索。',
    '- 用简洁的中文回答。',
  ].join('\n'),
  tier: 'standard',
  toolNames: ['knowledge_search', 'get_document'],
  maxSteps: 8,
}

/** wall-clock 熔断（ms）。 */
const RUN_WALL_CLOCK_MS = 120_000
/** 近似 token 预算（按字符数估算）的字符上限。 */
const RUN_CHAR_BUDGET = 200_000

export function createAgentService(deps: AgentDeps): AgentService {
  const { models, infra, logger, collectionService, retrieval } = deps
  const { llm } = infra

  async function loadWithAccess(p: Principal, conversationId: string, minRole: 'viewer' | 'editor') {
    const cv = await models.conversations.findById(conversationId)
    if (!cv) throw new AppError(ERROR_CODES.NOT_FOUND, '会话不存在')
    await collectionService.assertRole(p, cv.collection_id, minRole)
    return cv
  }

  /** 解析答案中的 [n] 标记，仅保留确有命中的引用，按 marker 升序。 */
  function validateCitations(answer: string, citations: Citation[]): Citation[] {
    const cited = new Set<number>()
    for (const m of answer.matchAll(/\[(\d+)\]/g)) cited.add(Number(m[1]))
    return citations.filter((c) => cited.has(c.marker)).sort((a, b) => a.marker - b.marker)
  }

  async function* ask(
    p: Principal,
    conversationId: string,
    question: string,
  ): AsyncIterable<AgentStreamEvent> {
    let cv
    try {
      cv = await loadWithAccess(p, conversationId, 'viewer')
    } catch (err) {
      yield { type: 'error', message: err instanceof AppError ? err.message : '无权访问会话' }
      return
    }

    const runId = uuidv7()
    try {
      const historyRows = await models.messages.listByConversation(conversationId)

      // 落库用户消息；首问且标题为占位时用问题生成标题。
      await models.messages.insert({ id: uuidv7(), conversationId, role: 'user', content: question })
      if (historyRows.length === 0 && cv.title === '新会话') {
        await models.conversations.setTitle(conversationId, truncate(question, 30))
      }

      await models.agentRuns.insert({
        id: runId,
        conversationId,
        agentName: KNOWLEDGE_ASSISTANT.name,
        input: question,
      })

      // 降级：未配置 chat 供应商 → 不进 ReAct，直接检索列片段（对齐 chat.service）。
      if (!llm.configured) {
        const chunks = await retrieval.retrieve(cv.collection_id, question)
        const answer = chunks.length
          ? `（未配置生成模型，以下为检索到的相关片段）\n\n${chunks
              .map((c) => `[${c.marker}] ${c.snippet}`)
              .join('\n')}`
          : '（未配置生成模型，且未检索到相关资料）'
        const citations = chunks.map((c) => toCitation(c, c.marker))
        yield { type: 'token', delta: answer }
        yield { type: 'citations', citations }
        const msg = await models.messages.insert({
          id: uuidv7(),
          conversationId,
          role: 'assistant',
          content: answer,
          citations,
        })
        await models.agentRuns.complete(runId, msg.id)
        await models.conversations.touch(conversationId)
        yield { type: 'done', messageId: msg.id, runId }
        return
      }

      // 装配工具注册表（授予 knowledge_assistant 的子集）+ run 上下文。
      const registry = createToolRegistry([
        createKnowledgeSearchTool(retrieval),
        createGetDocumentTool(models),
      ])
      const citations: Citation[] = []
      const ctx: RunContext = {
        collectionId: cv.collection_id,
        depth: 0,
        deadline: Date.now() + RUN_WALL_CLOCK_MS,
        charBudget: RUN_CHAR_BUDGET,
        signal: new AbortController().signal,
        registry,
        llm,
        logger,
        citations,
      }

      let answer = ''
      const inputBySeq = new Map<number, unknown>()
      for await (const ev of runAgent(KNOWLEDGE_ASSISTANT, question, ctx)) {
        switch (ev.type) {
          case 'reasoning':
            yield { type: 'reasoning', delta: ev.delta }
            break
          case 'text':
            answer += ev.delta
            yield { type: 'token', delta: ev.delta }
            break
          case 'step_start':
            inputBySeq.set(ev.seq, ev.input)
            yield { type: 'step_start', seq: ev.seq, kind: ev.kind, name: ev.name, input: ev.input }
            break
          case 'tool_result':
            await models.agentSteps.insert({
              id: uuidv7(),
              runId,
              seq: ev.seq,
              kind: ev.kind,
              name: ev.name,
              input: inputBySeq.get(ev.seq),
              output: ev.output,
              error: ev.error ?? null,
            })
            yield { type: 'tool_result', seq: ev.seq, ok: ev.ok, summary: ev.summary }
            break
          case 'final':
            answer = ev.answer || answer
            break
          case 'error':
            await models.agentRuns.fail(runId, ev.message)
            yield { type: 'error', message: ev.message }
            return
        }
      }

      // 引用校验 + 落库 assistant 消息 + 完成 run。
      const finalCitations = validateCitations(answer, citations)
      yield { type: 'citations', citations: finalCitations }
      const assistant = await models.messages.insert({
        id: uuidv7(),
        conversationId,
        role: 'assistant',
        content: answer,
        citations: finalCitations,
      })
      await models.agentRuns.complete(runId, assistant.id)
      await models.conversations.touch(conversationId)
      yield { type: 'done', messageId: assistant.id, runId }
    } catch (err) {
      logger.error({ conversationId, runId, err }, 'agent ask 失败')
      await models.agentRuns
        .fail(runId, err instanceof Error ? err.message : '运行失败')
        .catch(() => {})
      yield { type: 'error', message: err instanceof Error ? err.message : '运行失败' }
    }
  }

  return { ask }
}

function toCitation(c: RetrievedChunk, marker: number): Citation {
  return {
    marker,
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
