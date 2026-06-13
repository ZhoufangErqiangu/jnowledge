import { uuidv7 } from 'uuidv7'
import type { Citation, ContextItemState, RawContextStreamEvent } from '@jnowledge/shared'
import type {
  ContextItemMeta,
  ContextItemRepo,
  ContextItemRow,
} from '../../../models/contextItem.repo.js'
import type { AgentEvent, LlmCallStat } from '../../infra/agent/index.js'
import { toContextItemDebug } from './projection.js'

/**
 * RunRecorder：把一次 run 产生的 AgentEvent 落成 context_items 的「写侧」收口。
 * 顶层 run（TopLevelAgent）与子 run（SubAgent）共用同一套落库逻辑（经 RecordedAgent），仅 state 不同：
 * - 顶层：state='active'，进 LLM/用户视图。
 * - 子 run：state='internal'，留痕于 raw 但不进任一视图（第三状态，DESIGN §8.3/§8.4）。
 *
 * 只负责 DB 写：SSE 推流、answer/citation 累加、run complete/fail 仍由调用方持有。
 * 内部维护 step_start→tool_result 的 seq→input 关联，与逐轮思考过程（pendingReasoning）累加。
 */
export interface RunRecorderBase {
  conversationId: string
  runId: string
  state: ContextItemState
  /** 原始上下文事件汇（DESIGN §8.9）：每次落条目即发 item、每个增量即发 patch；缺省则纯落库。 */
  sink?: (ev: RawContextStreamEvent) => void
}

export function createRunRecorder(contextItems: ContextItemRepo, base: RunRecorderBase) {
  const { conversationId, runId, state, sink } = base
  const inputBySeq = new Map<number, unknown>()
  // 本轮（当前 LLM 调用）思考过程累积；落到该轮 assistant 的 meta.reasoning 后清空。
  let pendingReasoning = ''

  /** 落库行 → item 事件（与 DB 回放同形）。 */
  const emitItem = (row: ContextItemRow): void =>
    sink?.({ type: 'item', item: toContextItemDebug(row) })

  return {
    /** 思考增量累加（落到下一条 assistant 的 meta.reasoning）+ 发 reasoning patch（落定前增量）。 */
    addReasoning(delta: string): void {
      pendingReasoning += delta
      sink?.({ type: 'patch', runId, field: 'reasoning', delta })
    },

    /** 正文增量：仅发 text patch（落定前增量；终答内容在 finalAssistant 落库，此处不存）。 */
    noteText(delta: string): void {
      sink?.({ type: 'patch', runId, field: 'text', delta })
    },

    /** step_start 携带的工具入参——暂存，等配对的 tool_result 落库时取用。 */
    noteInput(seq: number, input: unknown): void {
      inputBySeq.set(seq, input)
    },

    /** 中间 assistant 轮（发起了工具调用）：toolCalls + 本轮思考 + 本次 LLM 调用耗时/用量进 meta。 */
    async assistant(ev: Extract<AgentEvent, { type: 'assistant' }>): Promise<void> {
      const meta: ContextItemMeta = {
        ...(ev.toolCalls ? { toolCalls: ev.toolCalls } : {}),
        ...(pendingReasoning ? { reasoning: pendingReasoning } : {}),
        ...(ev.llm ? { llm: ev.llm } : {}),
      }
      const row = await contextItems.insert({
        id: uuidv7(),
        conversationId,
        runId,
        kind: 'assistant',
        content: ev.content ?? '',
        flags: { state },
        ...(Object.keys(meta).length ? { meta } : {}),
      })
      pendingReasoning = ''
      emitItem(row)
    },

    /** 工具结果：content 存 LLM 实际看到的字符串（往返真相源）；结构化 output/入参进 meta 供诊断。 */
    async toolResult(ev: Extract<AgentEvent, { type: 'tool_result' }>): Promise<void> {
      const row = await contextItems.insert({
        id: uuidv7(),
        conversationId,
        runId,
        kind: 'tool_result',
        content: typeof ev.output === 'string' ? ev.output : JSON.stringify(ev.output ?? null),
        flags: { state },
        meta: {
          seq: ev.seq,
          name: ev.name,
          toolCallId: ev.toolCallId,
          ok: ev.ok,
          error: ev.error ?? null,
          summary: ev.summary,
          input: inputBySeq.get(ev.seq),
          output: ev.output,
        },
      })
      emitItem(row)
    },

    /** 终答 assistant 条目（带引用 + 末轮思考 + 产出该终答那次 LLM 调用的耗时/用量）；返回落库行供回填 run。 */
    async finalAssistant(
      content: string,
      citations: Citation[],
      llm?: LlmCallStat,
    ): Promise<ContextItemRow> {
      const meta: ContextItemMeta = {
        ...(pendingReasoning ? { reasoning: pendingReasoning } : {}),
        ...(llm ? { llm } : {}),
      }
      const row = await contextItems.insert({
        id: uuidv7(),
        conversationId,
        runId,
        kind: 'assistant',
        content,
        citations,
        flags: { state },
        ...(Object.keys(meta).length ? { meta } : {}),
      })
      pendingReasoning = ''
      emitItem(row)
      return row
    },
  }
}

export type RunRecorder = ReturnType<typeof createRunRecorder>
