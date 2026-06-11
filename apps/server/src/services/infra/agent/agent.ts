import type { LlmTier } from '@jnowledge/shared'
import type { AgentTurnMessage, LlmUsage, Thinking, ToolCall, ToolSpec } from '../llm/types.js'
import { LlmError } from '../llm/types.js'
import { toToolSpec } from './registry.js'
import {
  type AgentEvent,
  type LlmCallStat,
  type RunContext,
  type Tool,
  DEFAULT_MAX_STEPS,
} from './types.js'

/** 构造一个 agent 所需：身份 + 能力 + 记忆（前轮对话）。一次 run 一个实例（前轮对话每轮不同）。 */
export interface AgentConfig {
  name: string
  description: string
  tier: LlmTier
  /** 主推理 thinking 开关；缺省（undefined）随模型默认，不下发 thinking 参数。 */
  thinking?: Thinking
  /** 最大步数熔断（默认 DEFAULT_MAX_STEPS）。 */
  maxSteps?: number
  /** 已组装的 system 前缀（domain 经 assembleSystemPrompt 产出；易变后缀走 history）。 */
  system: string
  /** 被授予的工具子集（含 handler/schema），构造期注入——loop 内不再查 registry。 */
  tools: Tool[]
  /** 前轮对话 + 本轮 user + scopeSuffix?（projectForLlm 产出，**不含 system**，由本类前置）。 */
  history: AgentTurnMessage[]
}

/** decide 钩子产物：本轮那次 LLM 调用的结果。 */
interface TurnResult {
  answer: string
  toolCalls?: ToolCall[]
  llm: LlmCallStat
}

/**
 * 通用 Agent 基类：标准 ReAct / tool-calling 运行循环。专门负责「运行」——
 * agent 的身份（system）、能力（tools）、记忆（前轮对话）在**构造期**注入，
 * 本次运行环境（熔断预算 / llm / scope / 引用聚合器…）经 `run(ctx)` 注入。
 *
 * 每轮让模型在「被授予的工具集」里选；选了工具 → 校验参数 → 跑 handler → 回喂结果 → 继续；
 * 不选工具（给出最终答复）→ 收流式 text 作 answer → 终止。
 *
 * 上下文（system + 历史 + 本轮 user）已由调用方经投影引擎重建后注入——这是「模型自管理上下文」
 * 的接缝：实际推理上下文 = flag 派生的视图。
 *
 * 四重熔断：maxSteps（步数）/ MAX_AGENT_DEPTH（递归深度，见 agentAsTool）/
 * charBudget（近似 token 预算）/ deadline（wall-clock）。越界即 emit error 收尾。
 *
 * 可覆盖钩子：`decide`（一次决策/LLM 调用）与 `invokeTool`（单个工具执行）为 `protected`，
 * 未来 `OrchestratorAgent extends Agent` 覆盖即可换决策策略/调度，无需重写整圈循环。
 */
export class Agent {
  protected readonly maxSteps: number
  protected readonly toolsByName: Map<string, Tool>
  protected readonly toolSpecs: ToolSpec[]
  /** 运行消息序列：构造期 = [{system}, ...history]，loop 内原地追加 assistant/tool 轮。 */
  protected readonly messages: AgentTurnMessage[]
  /** 近似 token 预算的累计字符数（含 reasoning/text/工具结果增量）。 */
  protected approxChars: number

  constructor(protected readonly config: AgentConfig) {
    this.maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS
    this.toolsByName = new Map(config.tools.map((t) => [t.name, t]))
    this.toolSpecs = config.tools.map(toToolSpec)
    this.messages = [{ role: 'system', content: config.system }, ...config.history]
    this.approxChars = this.messages.reduce(
      (n, m) => n + ('content' in m ? (m.content?.length ?? 0) : 0),
      0,
    )
  }

  /** 模板方法：默认 ReAct 循环，产出 AgentEvent 流。 */
  async *run(ctx: RunContext): AsyncIterable<AgentEvent> {
    let seq = 0

    for (let step = 0; step < this.maxSteps; step++) {
      if (ctx.signal.aborted) return
      if (this.approxChars > ctx.charBudget) {
        yield { type: 'error', message: 'token 预算超限（熔断）' }
        return
      }

      let turn: TurnResult
      try {
        turn = yield* this.decide(ctx)
      } catch (err) {
        const message =
          err instanceof LlmError && err.kind === 'timeout'
            ? `单步推理超时（${ctx.stepTimeoutMs}ms 熔断）`
            : err instanceof Error
              ? err.message
              : '推理失败'
        yield { type: 'error', message }
        return
      }
      // decide 在 abort 时中断流并返回部分结果；这里收口，不再 emit final/error。
      if (ctx.signal.aborted) return

      // 没有工具调用 → 最终答复。
      if (!turn.toolCalls || turn.toolCalls.length === 0) {
        yield { type: 'final', answer: turn.answer, llm: turn.llm }
        return
      }

      // 记录本轮 assistant（带 tool_calls），随后逐个执行工具并回喂。
      this.messages.push(
        turn.answer
          ? { role: 'assistant', content: turn.answer, toolCalls: turn.toolCalls }
          : { role: 'assistant', toolCalls: turn.toolCalls },
      )
      // emit 在 step_start 之前 → service 落库顺序 = (assistant, ...tool_result)，与逻辑序一致。
      yield {
        type: 'assistant',
        ...(turn.answer ? { content: turn.answer } : {}),
        toolCalls: turn.toolCalls,
        llm: turn.llm,
      }

      for (const call of turn.toolCalls) {
        seq++
        yield* this.invokeTool(call, seq, ctx)
      }
    }

    yield { type: 'error', message: `达到最大步数（${this.maxSteps}）熔断` }
  }

  /**
   * 钩子①：跑一次 LLM 调用，流式 emit reasoning/text，返回本轮结果（含本次调用耗时/用量）。
   * wall-clock 耗时 = 建连到流耗尽（首 token 延迟 + 生成时长），归到该轮 assistant。
   * abort 时中断流消费、返回部分结果（由 run 收口）。可被覆盖以更换决策策略。
   */
  protected async *decide(ctx: RunContext): AsyncGenerator<AgentEvent, TurnResult> {
    let answer = ''
    let toolCalls: ToolCall[] | undefined
    let usage: LlmUsage | undefined
    const startedAt = Date.now()
    for await (const chunk of ctx.llm.chat
      .tier(this.config.tier)
      .generateStream({
        messages: this.messages,
        tools: this.toolSpecs,
        timeoutMs: ctx.stepTimeoutMs,
        ...(this.config.thinking !== undefined ? { thinking: this.config.thinking } : {}),
      })) {
      if (ctx.signal.aborted) break
      if (chunk.type === 'reasoning') {
        this.approxChars += chunk.delta.length
        yield { type: 'reasoning', delta: chunk.delta }
      } else if (chunk.type === 'text') {
        answer += chunk.delta
        this.approxChars += chunk.delta.length
        yield { type: 'text', delta: chunk.delta }
      } else if (chunk.type === 'usage') {
        usage = chunk.usage
      } else {
        toolCalls = chunk.calls
      }
    }
    const llm: LlmCallStat = { durationMs: Date.now() - startedAt, ...(usage ? { usage } : {}) }
    return { answer, ...(toolCalls ? { toolCalls } : {}), llm }
  }

  /**
   * 钩子②：校验 + 执行单个工具调用，emit step_start/tool_result，原地追加 tool 消息回喂。
   * 未知/未授予、参数校验失败、handler 抛错一律「回喂错误让模型纠正」，不中断 run。可被覆盖。
   */
  protected async *invokeTool(
    call: ToolCall,
    seq: number,
    ctx: RunContext,
  ): AsyncGenerator<AgentEvent, void> {
    const tool = this.toolsByName.get(call.name)
    // 轨迹类别：普通工具='tool'；被当作工具调用的子 agent（buildSubAgentTool 标 kind='agent'）='agent'，
    // 让前端轨迹/调试页区分「调工具」与「切到子 agent 上下文」。未知工具按 'tool' 呈现。
    const kind = tool?.kind ?? 'tool'
    yield { type: 'step_start', seq, kind, name: call.name, input: call.arguments }

    // 未授予 / 未知工具：回喂错误让模型纠正，不中断 run。
    if (!tool) {
      const msg = `未知或未授予的工具：${call.name}`
      this.messages.push({ role: 'tool', toolCallId: call.id, content: msg })
      yield {
        type: 'tool_result',
        seq,
        kind,
        name: call.name,
        toolCallId: call.id,
        ok: false,
        summary: msg,
        output: null,
        error: msg,
      }
      return
    }

    const parsed = tool.paramsSchema.safeParse(call.arguments)
    if (!parsed.success) {
      const errMsg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      const content = `参数校验失败：${errMsg}。请按 schema 修正后重试。`
      this.messages.push({ role: 'tool', toolCallId: call.id, content })
      yield {
        type: 'tool_result',
        seq,
        kind,
        name: call.name,
        toolCallId: call.id,
        ok: false,
        summary: content,
        output: null,
        error: errMsg,
      }
      return
    }

    try {
      const result = await tool.handler(parsed.data, ctx)
      const content =
        typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
      this.approxChars += content.length
      this.messages.push({ role: 'tool', toolCallId: call.id, content })
      yield {
        type: 'tool_result',
        seq,
        kind,
        name: call.name,
        toolCallId: call.id,
        ok: result.ok,
        summary: result.summary,
        output: result.output,
        ...(result.error !== undefined ? { error: result.error } : {}),
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '工具执行失败'
      ctx.logger.warn({ err, tool: call.name }, '工具执行异常')
      this.messages.push({ role: 'tool', toolCallId: call.id, content: `工具执行失败：${errMsg}` })
      yield {
        type: 'tool_result',
        seq,
        kind,
        name: call.name,
        toolCallId: call.id,
        ok: false,
        summary: `工具执行失败：${errMsg}`,
        output: null,
        error: errMsg,
      }
    }
  }
}
