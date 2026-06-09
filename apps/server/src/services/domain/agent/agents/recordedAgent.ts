import type { Citation, ContextItemState } from '@jnowledge/shared'
import type { AgentRunRepo } from '../../../../models/agentRun.repo.js'
import type { ContextItemRepo, ContextItemRow } from '../../../../models/contextItem.repo.js'
import { Agent, type AgentConfig, type AgentEvent, type LlmCallStat, type RunContext } from '../../../infra/agent/index.js'
import { createRunRecorder, type RunRecorder } from '../runRecorder.js'

/** RecordedAgent 的落库依赖（run 生命周期 + context_items 写侧）。 */
export interface RecordedAgentDeps {
  contextItems: ContextItemRepo
  agentRuns: AgentRunRepo
}

/** driveAndRecord 的产物：累计终答 + 产出该终答那次 LLM 调用的耗时/用量。 */
export interface DriveResult {
  answer: string
  finalLlm?: LlmCallStat
}

/**
 * RecordedAgent：在「专门负责 run」的 {@link Agent} 之上，加一层**落库驱动**——
 * 驱动 `this.run(ctx)` 的事件流、按 `recordState` 落 context_items，并管 run 完成/失败回填。
 * 顶层（active，进 LLM/用户视图）与子 run（internal，仅留痕）共用同一份驱动逻辑（DESIGN §8.3/§8.4），
 * 只有 `recordState` 与「如何对外输出」（SSE vs ToolResult）由子类决定。
 *
 * 每个实例对应**一次 run**（前轮对话/任务在构造期注入），故 recorder 可懒建并实例内缓存。
 */
export abstract class RecordedAgent extends Agent {
  /** 本 run 落库的状态：'active'=进视图（顶层）/'internal'=仅留痕（子 run）。 */
  protected abstract readonly recordState: ContextItemState
  private recorder?: RunRecorder

  constructor(
    config: AgentConfig,
    protected readonly recordedDeps: RecordedAgentDeps,
  ) {
    super(config)
  }

  /** 本 run 的 recorder（懒建，绑定 ctx 的会话/run + 子类 recordState）。 */
  protected getRecorder(ctx: RunContext): RunRecorder {
    if (!this.recorder) {
      this.recorder = createRunRecorder(this.recordedDeps.contextItems, {
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        state: this.recordState,
      })
    }
    return this.recorder
  }

  /**
   * 驱动 run 循环 + 落库，并**原样转发**每个 AgentEvent（供子类翻成 SSE 或丢弃）；
   * 返回累计终答与终答 llm。遇 `error` 事件即抛出（由子类 catch 收尾，落 run=failed）。
   * 把原先散在 ask()/agentAsTool 的同形 switch 收敛到此唯一一份。
   */
  protected async *driveAndRecord(ctx: RunContext): AsyncGenerator<AgentEvent, DriveResult> {
    const recorder = this.getRecorder(ctx)
    let answer = ''
    let finalLlm: LlmCallStat | undefined
    for await (const ev of this.run(ctx)) {
      switch (ev.type) {
        case 'assistant':
          // 中间 assistant 轮（发起了工具调用）：toolCalls + 本轮思考进 meta 供诊断/v2 重建。
          await recorder.assistant(ev)
          break
        case 'reasoning':
          recorder.addReasoning(ev.delta)
          break
        case 'text':
          answer += ev.delta
          break
        case 'step_start':
          recorder.noteInput(ev.seq, ev.input)
          break
        case 'tool_result':
          await recorder.toolResult(ev)
          break
        case 'final':
          answer = ev.answer || answer
          finalLlm = ev.llm
          break
        case 'error':
          throw new Error(ev.message)
      }
      yield ev
    }
    return { answer, ...(finalLlm ? { finalLlm } : {}) }
  }

  /** 终答落库（active/internal 同逻辑）+ 回填 run=completed；返回终答条目。 */
  protected async complete(
    ctx: RunContext,
    answer: string,
    citations: Citation[],
    llm?: LlmCallStat,
  ): Promise<ContextItemRow> {
    const item = await this.getRecorder(ctx).finalAssistant(answer, citations, llm)
    await this.recordedDeps.agentRuns.complete(ctx.runId, item.id)
    return item
  }

  /** 标记 run=failed（吞写库异常，失败上报不应被二次失败掩盖）。 */
  protected async fail(ctx: RunContext, message: string): Promise<void> {
    await this.recordedDeps.agentRuns.fail(ctx.runId, message).catch(() => {})
  }
}

/** 排干一个只关心返回值的 AsyncGenerator（忽略其 yield 的事件）。 */
export async function drain<R>(gen: AsyncGenerator<unknown, R>): Promise<R> {
  while (true) {
    const r = await gen.next()
    if (r.done) return r.value
  }
}
