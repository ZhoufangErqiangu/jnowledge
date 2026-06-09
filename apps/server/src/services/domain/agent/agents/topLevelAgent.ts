import type { AgentStreamEvent, Citation } from '@jnowledge/shared'
import type { AgentRunRepo } from '../../../../models/agentRun.repo.js'
import type { ContextItemRepo } from '../../../../models/contextItem.repo.js'
import type { ConversationRepo } from '../../../../models/conversation.repo.js'
import type { Logger } from '../../../../logger.js'
import type { AgentTurnMessage } from '../../../infra/llm/types.js'
import type { AgentDef, RunContext, Tool } from '../../../infra/agent/index.js'
import { RecordedAgent } from './recordedAgent.js'

/** 增删改工具名（按 editor 权限在工具层校验）。 */
const WRITE_TOOL_NAMES = [
  'create_document',
  'update_document',
  'delete_document',
  'move_document',
  'create_collection',
  'rename_collection',
  'delete_collection',
]

/** 写能力 + 两阶段确认协议的系统提示。 */
const WRITE_GUIDE = [
  '你还可以增删改知识库内容（新建/修改/删除/移动文档，新建/重命名/删除知识库）。使用写工具时：',
  '- 仅在用户明确要求改动时才动手；改动前先想清楚目标对象与范围。',
  '- 若某次写调用返回「需用户确认」，必须把其中的计划与风险如实转述给用户并停下，不要继续执行；',
  '  待用户在后续消息中明确同意后，再按回执指示的工具名与 confirmToken 重新调用执行。严禁自行确认。',
  '  若回执提示操作已被「审计改写」，必须把改写后的实际操作如实说明给用户，再请其确认。',
  '- 若某次写调用返回「被拒绝执行」（高危操作），不要尝试绕过或换法重试；如实告知用户该操作需其到管理界面手动完成。',
  '- 若用户未同意或要求取消，则放弃该操作。',
]

/** 顶层助手 agent 依赖（run 生命周期 + 会话回填 + 日志）。 */
export interface TopLevelAgentDeps {
  contextItems: ContextItemRepo
  agentRuns: AgentRunRepo
  conversations: ConversationRepo
  logger: Logger
}

/**
 * 顶层 agent（assistant）：不绑库（作用域恒 principal，硬收窄只经委派产生），跨库检索回答。
 * 角色 = active 落库（进 LLM/用户视图）+ 把 run 事件流翻成 SSE + 引用校验 + run 生命周期收口。
 * 人设见 {@link TopLevelAgent.persona}；system 前缀/后缀的装配与「发送即快照」由 agent.service 完成后注入。
 */
export class TopLevelAgent extends RecordedAgent {
  /** assistant 人设（service 据此选工具子集、组装 system 前缀）。 */
  static readonly persona: AgentDef = {
    name: 'assistant',
    description: '可跨知识库检索回答问题的智能助手',
    system: [
      '你是智能助手，可调用工具跨多个知识库检索来回答用户问题。',
      '- 当问题需要依据知识库内容时：调用 rag_search(query) 检索——它会自动选库、混合检索并归纳出带 [序号] 出处的资料要点。',
      '  若用户指明了某个/某些知识库，在 rag_search 的 collectionIds 参数里传入对应 id 以限定范围；否则留空让其按相关性自动选库。',
      '  必要时可对不同角度多次调用 rag_search；也可先 list_collections 查看可访问的库及其 id。',
      '- 若某文档需要更完整上下文，可用 get_document 查看；仍不足则如实说明「根据现有资料无法回答」，不要臆测。',
      '- 回答时，凡引用了检索资料的句子，必须在句末用对应的 [序号] 标注来源（沿用 rag_search 返回的序号，可多个，如 [1][3]）。',
      '- 闲聊或无需知识库即可回答的问题，直接回答，不必检索。',
      '- 写操作需指定目标库/文档 id（可先用 list_collections 或 rag_search 获取）。',
      ...WRITE_GUIDE,
      '- 用简洁的中文回答。',
    ].join('\n'),
    tier: 'standard',
    toolNames: ['list_collections', 'rag_search', 'get_document', ...WRITE_TOOL_NAMES],
    maxSteps: 12,
  }

  protected readonly recordState = 'active' as const

  constructor(
    opts: { system: string; tools: Tool[]; history: AgentTurnMessage[] },
    private readonly deps: TopLevelAgentDeps,
  ) {
    const { persona } = TopLevelAgent
    super(
      {
        name: persona.name,
        description: persona.description,
        tier: persona.tier,
        ...(persona.maxSteps !== undefined ? { maxSteps: persona.maxSteps } : {}),
        system: opts.system,
        tools: opts.tools,
        history: opts.history,
      },
      { contextItems: deps.contextItems, agentRuns: deps.agentRuns },
    )
  }

  /** 流式问答：驱动 ReAct + active 落库 → SSE；尾段引用校验 + 终答落库 + run/会话收口。 */
  async *stream(ctx: RunContext): AsyncIterable<AgentStreamEvent> {
    // 降级：未配置 chat 供应商 → 不进 ReAct（agent 需模型自主选库检索，仅提示）。
    if (!ctx.llm.chat.configured) {
      const answer = '（未配置生成模型，助手需要生成模型才能选库检索）'
      yield { type: 'token', delta: answer }
      yield { type: 'citations', citations: [] }
      const item = await this.complete(ctx, answer, [])
      await this.deps.conversations.touch(ctx.conversationId)
      yield { type: 'done', messageId: item.id, runId: ctx.runId }
      return
    }

    let result
    try {
      const gen = this.driveAndRecord(ctx)
      for (;;) {
        const next = await gen.next()
        if (next.done) {
          result = next.value
          break
        }
        const ev = next.value
        // 中间 assistant / final / error 不外发 SSE（assistant 已 active 落库，final 仅供收尾）。
        switch (ev.type) {
          case 'reasoning':
            yield { type: 'reasoning', delta: ev.delta }
            break
          case 'text':
            yield { type: 'token', delta: ev.delta }
            break
          case 'step_start':
            yield { type: 'step_start', seq: ev.seq, kind: ev.kind, name: ev.name, input: ev.input }
            break
          case 'tool_result':
            yield { type: 'tool_result', seq: ev.seq, ok: ev.ok, summary: ev.summary }
            break
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '运行失败'
      this.deps.logger.error({ conversationId: ctx.conversationId, runId: ctx.runId, err }, 'agent ask 失败')
      await this.fail(ctx, message)
      yield { type: 'error', message }
      return
    }

    // 引用校验 + 落库终答 assistant 条目 + 完成 run。
    const finalCitations = validateCitations(result.answer, ctx.citations)
    yield { type: 'citations', citations: finalCitations }
    const item = await this.complete(ctx, result.answer, finalCitations, result.finalLlm)
    await this.deps.conversations.touch(ctx.conversationId)
    yield { type: 'done', messageId: item.id, runId: ctx.runId }
  }
}

/** 解析答案中的 [n] 标记，仅保留确有命中的引用，按 marker 升序。 */
export function validateCitations(answer: string, citations: Citation[]): Citation[] {
  const cited = new Set<number>()
  for (const m of answer.matchAll(/\[(\d+)\]/g)) cited.add(Number(m[1]))
  return citations.filter((c) => cited.has(c.marker)).sort((a, b) => a.marker - b.marker)
}
