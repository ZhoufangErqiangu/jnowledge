import { uuidv7 } from 'uuidv7'
import type { Citation, ContextItemState } from '@jnowledge/shared'
import type {
  ContextItemMeta,
  ContextItemRepo,
  ContextItemRow,
} from '../../../models/contextItem.repo.js'
import type { AgentEvent, LlmCallStat } from '../../infra/agent/index.js'

/**
 * RunRecorder：把一次 run 产生的 AgentEvent 落成 context_items 的「写侧」收口。
 * 顶层 run（agent.service）与子 run（agentAsTool）共用同一套落库逻辑，仅 state 不同：
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
}

export function createRunRecorder(contextItems: ContextItemRepo, base: RunRecorderBase) {
  const { conversationId, runId, state } = base
  const inputBySeq = new Map<number, unknown>()
  // 本轮（当前 LLM 调用）思考过程累积；落到该轮 assistant 的 meta.reasoning 后清空。
  let pendingReasoning = ''

  return {
    /** 思考增量累加（落到下一条 assistant 的 meta.reasoning）。 */
    addReasoning(delta: string): void {
      pendingReasoning += delta
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
      await contextItems.insert({
        id: uuidv7(),
        conversationId,
        runId,
        kind: 'assistant',
        content: ev.content ?? '',
        flags: { state },
        ...(Object.keys(meta).length ? { meta } : {}),
      })
      pendingReasoning = ''
    },

    /** 工具结果：content 存 LLM 实际看到的字符串（往返真相源）；结构化 output/入参进 meta 供诊断。 */
    async toolResult(ev: Extract<AgentEvent, { type: 'tool_result' }>): Promise<void> {
      await contextItems.insert({
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
      return row
    },
  }
}

export type RunRecorder = ReturnType<typeof createRunRecorder>
