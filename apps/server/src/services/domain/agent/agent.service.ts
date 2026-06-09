import { uuidv7 } from 'uuidv7'
import { ERROR_CODES, type AgentStreamEvent } from '@jnowledge/shared'
import type { Models } from '../../../models/index.js'
import { type RunContext, createToolRegistry } from '../../infra/agent/index.js'
import { assembleSystemPrompt, buildScopeSuffix } from './systemPrompt.js'
import { projectForLlm, toContextItemView } from './projection.js'
import { createOperationAuditor } from './operationAuditor.js'
import { createRelevanceFilter } from './relevanceFilter.js'
import { createGetDocumentTool } from './tools/getDocument.js'
import { createKnowledgeSearchTool } from './tools/knowledgeSearch.js'
import { createListCollectionsTool } from './tools/listCollections.js'
import { createMutationTools } from './tools/mutations.js'
import { TopLevelAgent } from './agents/topLevelAgent.js'
import { RagSearchAgent } from './agents/ragSearchAgent.js'
import type { Config } from '../../../config/index.js'
import type { Infra } from '../../infra/index.js'
import type { Logger } from '../../../logger.js'
import type { CollectionService, Principal } from '../collection.service.js'
import type { DocumentService } from '../document.service.js'
import type { RetrievalService } from '../retrieval.js'
import { AppError } from '../../../errors.js'

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

/** wall-clock 熔断（ms）。 */
const RUN_WALL_CLOCK_MS = 120_000
/** 近似 token 预算（按字符数估算）的字符上限。 */
const RUN_CHAR_BUDGET = 200_000
/** 跨轮历史投影进 LLM 上下文的字符预算（留余量给本轮工具结果与生成）。 */
const HISTORY_CHAR_BUDGET = 60_000

/**
 * AgentService：编排顶层一次问答的**数据准备 + 驱动**——ACL、落 run/user、装配工具与 system、
 * 建 RunContext，然后交给 {@link TopLevelAgent} 跑 ReAct 并产 SSE。
 * run 循环、落库、引用校验、run 生命周期收口都在 agent 子类里（见 agents/）。
 */
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

  /**
   * 工具注册表（顶层授予集）。检索经 rag_search 子 agent 委派：knowledge_search 只活在子 agent 内部、
   * **不授予顶层**；顶层见到的是 rag_search（kind='agent'，调它即切到检索子上下文）+ 读/写/列举工具。
   */
  function buildToolRegistry() {
    const knowledgeSearch = createKnowledgeSearchTool(
      retrieval,
      collectionService,
      relevanceFilter,
      models.contextItems,
    )
    const getDocument = createGetDocumentTool(models, collectionService)
    const listCollections = createListCollectionsTool(collectionService)
    // rag_search 子 agent 被授予的检索三件套（构造期注入到每个子 run 实例）。
    const ragSearch = RagSearchAgent.tool({
      tools: [listCollections, knowledgeSearch, getDocument],
      contextItems: models.contextItems,
      agentRuns: models.agentRuns,
    })
    return createToolRegistry([
      listCollections,
      ragSearch,
      getDocument,
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
    const persona = TopLevelAgent.persona
    try {
      // 全量历史（本轮提问入库前）——并据此判断是否首问。
      const priorItems = (await models.contextItems.listByConversation(conversationId)).map(
        toContextItemView,
      )
      if (priorItems.length === 0 && cv.title === '新会话') {
        await models.conversations.setTitle(conversationId, truncate(question, 30))
      }

      // run 先建（user 条目的 run_id 外键指向它），再落本轮 user 条目。
      await models.agentRuns.insert({ id: runId, conversationId, agentName: persona.name, input: question })
      const userItem = await models.contextItems.insert({
        id: uuidv7(),
        conversationId,
        runId,
        kind: 'user',
        content: question,
      })

      // 顶层 agent 不绑库：作用域恒 principal（实权由 assertRole 守）；硬收窄只经委派产生。
      const registry = buildToolRegistry()
      const ctx: RunContext = {
        scope: { ceiling: 'principal' },
        principal: { uid: p.uid, role: p.role },
        conversationId,
        runId,
        depth: 0,
        deadline: Date.now() + RUN_WALL_CLOCK_MS,
        charBudget: RUN_CHAR_BUDGET,
        signal: new AbortController().signal,
        llm,
        logger,
        citations: [],
      }

      // 可访问库：注入易变作用域后缀，模型直接用 id 检索、追问轮不臆造 collectionId（失败再 fallback）。
      const availableCollections = await collectionService
        .listAccessible(p)
        .then((cs) => cs.map((c) => ({ id: c.id, name: c.name })))
        .catch(() => undefined)
      const facts = {
        scope: { ceiling: 'principal' as const },
        ...(availableCollections ? { availableCollections } : {}),
      }
      // 缓存友好分两路（DESIGN §8.2）：稳定前缀（顶层=纯模板）置消息序最前、长期可缓存；
      // 易变可访问库列表走后缀（projectForLlm 插在历史之后、最新 user 轮之前），变化不动历史前缀。
      const system = assembleSystemPrompt(persona.system, facts)
      const scopeSuffix = buildScopeSuffix(facts)
      // 发送即快照（§14.5）：把本 run 实际发给模型的 system 内容落 internal 条目（归属本 run）——
      // 审计忠实、抗版本漂移，不靠事后重算。stage=system 为稳定前缀，stage=scope 为易变后缀。
      await models.contextItems.insert({
        id: uuidv7(),
        conversationId,
        runId,
        kind: 'tool_result',
        flags: { state: 'internal' },
        content: system,
        meta: { stage: 'system', name: persona.name, summary: 'agent system prompt 前缀快照' },
      })
      if (scopeSuffix) {
        await models.contextItems.insert({
          id: uuidv7(),
          conversationId,
          runId,
          kind: 'tool_result',
          flags: { state: 'internal' },
          content: scopeSuffix,
          meta: { stage: 'scope', name: persona.name, summary: 'agent 作用域后缀快照' },
        })
      }
      // 本轮 user 已落库 → 投影含本轮 user；history 不含 system（由 Agent 构造期前置），
      // scopeSuffix 仍由 projectForLlm 贴在最新 user 轮之前（保前缀缓存）。
      const history = projectForLlm([...priorItems, toContextItemView(userItem)], {
        ...(scopeSuffix ? { scopeSuffix } : {}),
        budget: HISTORY_CHAR_BUDGET,
      })

      // 顶层 agent：身份/工具/前轮对话构造期注入；run+落库+引用校验+生命周期收口都在 agent 内。
      const agent = new TopLevelAgent(
        { system, tools: registry.select(persona.toolNames), history },
        {
          contextItems: models.contextItems,
          agentRuns: models.agentRuns,
          conversations: models.conversations,
          logger,
        },
      )
      yield* agent.stream(ctx)
    } catch (err) {
      logger.error({ conversationId, runId, err }, 'agent ask 准备失败')
      await models.agentRuns.fail(runId, err instanceof Error ? err.message : '运行失败').catch(() => {})
      yield { type: 'error', message: err instanceof Error ? err.message : '运行失败' }
    }
  }

  return { ask }
}

function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n)}…`
}
