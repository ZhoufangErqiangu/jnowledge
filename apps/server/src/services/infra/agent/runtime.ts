import type { AgentTurnMessage, ToolCall } from '../llm/types.js'
import { type AgentDef, type AgentEvent, type RunContext, DEFAULT_MAX_STEPS } from './types.js'

/**
 * 通用 Agent Runtime：标准 ReAct / tool-calling 循环。
 * 每轮让模型在「被授予的工具集」里选；选了工具 → 校验参数 → 跑 handler → 回喂结果 → 继续；
 * 不选工具（给出最终答复）→ 收流式 text 作 answer → 终止。
 *
 * 四重熔断：maxSteps（步数）/ MAX_AGENT_DEPTH（递归深度，见 agentAsTool）/
 * charBudget（近似 token 预算）/ deadline（wall-clock）。越界即 emit error 收尾。
 */
export async function* runAgent(
  def: AgentDef,
  input: string,
  ctx: RunContext,
): AsyncIterable<AgentEvent> {
  const maxSteps = def.maxSteps ?? DEFAULT_MAX_STEPS
  const tools = ctx.registry.specsFor(def.toolNames)
  const messages: AgentTurnMessage[] = [
    { role: 'system', content: def.system },
    { role: 'user', content: input },
  ]
  let approxChars = input.length
  let seq = 0

  for (let step = 0; step < maxSteps; step++) {
    if (ctx.signal.aborted) return
    if (Date.now() > ctx.deadline) {
      yield { type: 'error', message: '运行超时（wall-clock 熔断）' }
      return
    }
    if (approxChars > ctx.charBudget) {
      yield { type: 'error', message: 'token 预算超限（熔断）' }
      return
    }

    let answer = ''
    let toolCalls: ToolCall[] | undefined
    for await (const chunk of ctx.llm.tier(def.tier).generateStream({ messages, tools })) {
      if (ctx.signal.aborted) return
      if (chunk.type === 'reasoning') {
        approxChars += chunk.delta.length
        yield { type: 'reasoning', delta: chunk.delta }
      } else if (chunk.type === 'text') {
        answer += chunk.delta
        approxChars += chunk.delta.length
        yield { type: 'text', delta: chunk.delta }
      } else {
        toolCalls = chunk.calls
      }
    }

    // 没有工具调用 → 最终答复。
    if (!toolCalls || toolCalls.length === 0) {
      yield { type: 'final', answer }
      return
    }

    // 记录本轮 assistant（带 tool_calls），随后逐个执行工具并回喂。
    messages.push(
      answer ? { role: 'assistant', content: answer, toolCalls } : { role: 'assistant', toolCalls },
    )

    for (const call of toolCalls) {
      seq++
      yield { type: 'step_start', seq, kind: 'tool', name: call.name, input: call.arguments }

      const tool = ctx.registry.get(call.name)
      // 未授予 / 未知工具：回喂错误让模型纠正，不中断 run。
      if (!tool || !def.toolNames.includes(call.name)) {
        const msg = `未知或未授予的工具：${call.name}`
        messages.push({ role: 'tool', toolCallId: call.id, content: msg })
        yield {
          type: 'tool_result',
          seq,
          kind: 'tool',
          name: call.name,
          ok: false,
          summary: msg,
          output: null,
          error: msg,
        }
        continue
      }

      const parsed = tool.paramsSchema.safeParse(call.arguments)
      if (!parsed.success) {
        const errMsg = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
        const content = `参数校验失败：${errMsg}。请按 schema 修正后重试。`
        messages.push({ role: 'tool', toolCallId: call.id, content })
        yield {
          type: 'tool_result',
          seq,
          kind: 'tool',
          name: call.name,
          ok: false,
          summary: content,
          output: null,
          error: errMsg,
        }
        continue
      }

      try {
        const result = await tool.handler(parsed.data, ctx)
        const content =
          typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
        approxChars += content.length
        messages.push({ role: 'tool', toolCallId: call.id, content })
        yield {
          type: 'tool_result',
          seq,
          kind: 'tool',
          name: call.name,
          ok: result.ok,
          summary: result.summary,
          output: result.output,
          ...(result.error !== undefined ? { error: result.error } : {}),
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '工具执行失败'
        ctx.logger.warn({ err, tool: call.name }, '工具执行异常')
        messages.push({ role: 'tool', toolCallId: call.id, content: `工具执行失败：${errMsg}` })
        yield {
          type: 'tool_result',
          seq,
          kind: 'tool',
          name: call.name,
          ok: false,
          summary: `工具执行失败：${errMsg}`,
          output: null,
          error: errMsg,
        }
      }
    }
  }

  yield { type: 'error', message: `达到最大步数（${maxSteps}）熔断` }
}
