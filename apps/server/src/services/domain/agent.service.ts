import { uuidv7 } from 'uuidv7'
import { ERROR_CODES, type AgentStreamEvent, type Citation } from '@jnowledge/shared'
import type { Models } from '../../models/index.js'
import {
  type AgentDef,
  type RunContext,
  assembleSystemPrompt,
  createGetDocumentTool,
  createKnowledgeSearchTool,
  createListCollectionsTool,
  createMutationTools,
  createOperationAuditor,
  createRelevanceFilter,
  createRunRecorder,
  createToolRegistry,
  projectForLlm,
  runAgent,
  toContextItemView,
} from '../infra/agent/index.js'
import type { Config } from '../../config/index.js'
import type { Infra } from '../infra/index.js'
import type { Logger } from '../../logger.js'
import type { CollectionService, Principal } from './collection.service.js'
import type { DocumentService } from './document.service.js'
import type { RetrievalService } from './retrieval.js'
import { AppError } from '../../errors.js'

export interface AgentDeps {
  config: Config
  models: Models
  infra: Infra
  logger: Logger
  collectionService: CollectionService
  documentService: DocumentService
  retrieval: RetrievalService
}

export interface AgentService {
  /** Agent 流式问答：ReAct 自主编排检索/读文档；产 SSE 轨迹 + 答复；落 run/steps/message。 */
  ask(p: Principal, conversationId: string, question: string): AsyncIterable<AgentStreamEvent>
}

/** 增删改工具名（两个 agent 都授予；权限由服务层按 editor 校验）。 */
const WRITE_TOOL_NAMES = [
  'create_document',
  'update_document',
  'delete_document',
  'move_document',
  'create_collection',
  'rename_collection',
  'delete_collection',
]

/** 写能力 + 两阶段确认协议的系统提示（两个 agent 共用）。 */
const WRITE_GUIDE = [
  '你还可以增删改知识库内容（新建/修改/删除/移动文档，新建/重命名/删除知识库）。使用写工具时：',
  '- 仅在用户明确要求改动时才动手；改动前先想清楚目标对象与范围。',
  '- 若某次写调用返回「需用户确认」，必须把其中的计划与风险如实转述给用户并停下，不要继续执行；',
  '  待用户在后续消息中明确同意后，再按回执指示的工具名与 confirmToken 重新调用执行。严禁自行确认。',
  '  若回执提示操作已被「审计改写」，必须把改写后的实际操作如实说明给用户，再请其确认。',
  '- 若某次写调用返回「被拒绝执行」（高危操作），不要尝试绕过或换法重试；如实告知用户该操作需其到管理界面手动完成。',
  '- 若用户未同意或要求取消，则放弃该操作。',
]

/**
 * 唯一的智能助手 agent（不绑库）：作用域是 run 的属性而非 agent 身份——顶层恒为 principal
 * 全量可访问库，要限定某库由用户在对话中声明（选择器层），硬收窄只经 agentAsTool 委派产生。
 * 先 list_collections 选库，再带 collectionId 检索（可跨多库）。
 */
const ASSISTANT: AgentDef = {
  name: 'assistant',
  description: '可跨知识库检索回答问题的智能助手',
  system: [
    '你是智能助手，可调用工具跨多个知识库检索来回答用户问题。',
    '- 当问题需要依据知识库内容时：先调用 list_collections 查看可访问的知识库及其 id；',
    '  再选定最相关的库，以其 id 调用 knowledge_search(query, collectionId) 检索；必要时对多个库分别检索。',
    '- 若用户指明了某个/某些知识库，就只在其范围内检索；否则按问题相关性自行选库。',
    '- 若检索片段不足，可用 get_document 查看某文档更多上下文；仍不足则如实说明「根据现有资料无法回答」，不要臆测。',
    '- 回答时，凡引用了检索资料的句子，必须在句末用对应的 [序号] 标注来源（可多个，如 [1][3]）。',
    '- 闲聊或无需知识库即可回答的问题，直接回答，不必检索。',
    '- 写操作需指定目标库/文档 id（可先用 list_collections 或 knowledge_search 获取）。',
    ...WRITE_GUIDE,
    '- 用简洁的中文回答。',
  ].join('\n'),
  tier: 'standard',
  toolNames: ['list_collections', 'knowledge_search', 'get_document', ...WRITE_TOOL_NAMES],
  maxSteps: 12,
}

/** wall-clock 熔断（ms）。 */
const RUN_WALL_CLOCK_MS = 120_000
/** 近似 token 预算（按字符数估算）的字符上限。 */
const RUN_CHAR_BUDGET = 200_000
/** 跨轮历史投影进 LLM 上下文的字符预算（留余量给本轮工具结果与生成）。 */
const HISTORY_CHAR_BUDGET = 60_000

export function createAgentService(deps: AgentDeps): AgentService {
  const { config, models, infra, logger, collectionService, documentService, retrieval } = deps
  const { llm } = infra
  const auditor = createOperationAuditor(llm.chat)
  const relevanceFilter = createRelevanceFilter(llm.chat, {
    skipThreshold: config.rag.filterSkipThreshold,
  })

  async function loadWithAccess(
    p: Principal,
    conversationId: string,
    minRole: 'viewer' | 'editor',
  ) {
    const cv = await models.conversations.findById(conversationId)
    if (!cv) throw new AppError(ERROR_CODES.NOT_FOUND, '会话不存在')
    if (cv.collection_id) {
      // 知识库会话：复用 collection 成员关系做 ACL。
      await collectionService.assertRole(p, cv.collection_id, minRole)
    } else if (cv.created_by !== p.uid && p.role !== 'admin') {
      // 全局会话：仅创建者（或 admin）可访问。
      throw new AppError(ERROR_CODES.FORBIDDEN, '无权访问该会话')
    }
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
    // 顶层 run 的落库收口（state=active，进 LLM/用户视图）；与子 run 共用同一套写逻辑。
    const recorder = createRunRecorder(models.contextItems, {
      conversationId,
      runId,
      state: 'active',
    })
    try {
      // 全量历史（本轮提问入库前）——投影成 LLM 上下文，并据此判断是否首问。
      const priorItems = (await models.contextItems.listByConversation(conversationId)).map(
        toContextItemView,
      )
      if (priorItems.length === 0 && cv.title === '新会话') {
        await models.conversations.setTitle(conversationId, truncate(question, 30))
      }

      // 唯一 agent：顶层不绑库，作用域恒 principal（要限定某库由用户在对话中声明）。
      const agentDef = ASSISTANT

      // run 先建（user 条目的 run_id 外键指向它），再落本轮 user 条目。
      await models.agentRuns.insert({
        id: runId,
        conversationId,
        agentName: agentDef.name,
        input: question,
      })
      const userItem = await models.contextItems.insert({
        id: uuidv7(),
        conversationId,
        runId,
        kind: 'user',
        content: question,
      })

      // 降级：未配置 chat 供应商 → 不进 ReAct。agent 不绑库、需模型自主选库检索，故仅提示。
      if (!llm.chat.configured) {
        const answer = '（未配置生成模型，助手需要生成模型才能选库检索）'
        yield { type: 'token', delta: answer }
        yield { type: 'citations', citations: [] }
        const msg = await recorder.finalAssistant(answer, [])
        await models.agentRuns.complete(runId, msg.id)
        await models.conversations.touch(conversationId)
        yield { type: 'done', messageId: msg.id, runId }
        return
      }

      // 装配工具注册表（全集；agent 按 toolNames 授予子集）+ run 上下文。
      const registry = createToolRegistry([
        createKnowledgeSearchTool(retrieval, collectionService, relevanceFilter),
        createGetDocumentTool(models, collectionService),
        createListCollectionsTool(collectionService),
        ...createMutationTools({
          documentService,
          collectionService,
          auditor,
          pendingOps: models.pendingOperations,
          contextItems: models.contextItems,
          collections: models.collections,
          documents: models.documents,
        }),
      ])
      const citations: Citation[] = []
      const ctx: RunContext = {
        // 顶层 agent 不绑库：作用域恒 principal（实权由 assertRole 守）；硬收窄只经 agentAsTool 委派。
        scope: { ceiling: 'principal' },
        principal: { uid: p.uid, role: p.role },
        conversationId,
        runId,
        depth: 0,
        deadline: Date.now() + RUN_WALL_CLOCK_MS,
        charBudget: RUN_CHAR_BUDGET,
        signal: new AbortController().signal,
        registry,
        llm,
        logger,
        citations,
      }

      // 动态 system：稳定模板（agentDef.system）+ 确定性 facts（本 run 作用域，顶层恒 principal）。
      const system = assembleSystemPrompt(agentDef.system, { scope: { ceiling: 'principal' } })
      // 发送即快照（§14.5）：把本 run 实际发给模型的 system 落 internal 条目（归属本 run）——
      // 审计忠实、抗版本漂移，不靠事后重算（assembler/模板是会迭代的代码）。
      await models.contextItems.insert({
        id: uuidv7(),
        conversationId,
        runId,
        kind: 'tool_result',
        flags: { state: 'internal' },
        content: system,
        meta: { stage: 'system', name: agentDef.name, summary: 'agent system prompt 快照' },
      })
      // 本轮 user 已落库 → 投影含本轮 user；runtime 不再自拼 [system, user]。
      const initialMessages = projectForLlm([...priorItems, toContextItemView(userItem)], {
        system,
        budget: HISTORY_CHAR_BUDGET,
      })

      let answer = ''
      for await (const ev of runAgent(agentDef, initialMessages, ctx)) {
        switch (ev.type) {
          case 'assistant':
            // 中间 assistant 轮（发起了工具调用）：toolCalls + 本轮思考进 meta 供诊断/v2 重建。
            await recorder.assistant(ev)
            break
          case 'reasoning':
            recorder.addReasoning(ev.delta)
            yield { type: 'reasoning', delta: ev.delta }
            break
          case 'text':
            answer += ev.delta
            yield { type: 'token', delta: ev.delta }
            break
          case 'step_start':
            recorder.noteInput(ev.seq, ev.input)
            yield { type: 'step_start', seq: ev.seq, kind: ev.kind, name: ev.name, input: ev.input }
            break
          case 'tool_result':
            await recorder.toolResult(ev)
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

      // 引用校验 + 落库终答 assistant 条目 + 完成 run。
      const finalCitations = validateCitations(answer, citations)
      yield { type: 'citations', citations: finalCitations }
      const assistant = await recorder.finalAssistant(answer, finalCitations)
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

function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n)}…`
}
