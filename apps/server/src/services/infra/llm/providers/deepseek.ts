import type { Thinking, ThinkingEffort } from '../types.js'
import { normalizeThinking } from '../types.js'
import { OpenAIChatProvider } from './openai.js'

export type { OpenAIChatConfig as DeepSeekConfig } from './openai.js'

/**
 * DeepSeek chat 供应商。OpenAI 形状的全部 wire 机制继承自 OpenAIChatProvider；
 * 唯一供应商特异处是 thinking 旋钮：thinking.type(enabled/disabled) + reasoning_effort(high/max)。
 */
export class DeepSeekChatProvider extends OpenAIChatProvider {
  /**
   * DeepSeek 官方旋钮：thinking.type(enabled/disabled) + reasoning_effort(high/max)。
   * - default（省略）：不发 thinking 字段，随模型默认（DeepSeek 默认 enabled）。
   * - off（显式 false）：发 {thinking:{type:'disabled'}}，真关。
   * - on：发 enabled，并把归一化 effort 映射到 reasoning_effort（low/medium→high，high→max；无 effort 则随默认 high）。
   * budgetTokens 在 DeepSeek 无原生 token 预算旋钮，静默忽略。
   */
  protected thinkingBody(opts: { thinking?: Thinking }): Record<string, unknown> {
    const t = normalizeThinking(opts.thinking)
    if (t.mode === 'default') return {}
    if (t.mode === 'off') return { thinking: { type: 'disabled' } }
    const body: Record<string, unknown> = { thinking: { type: 'enabled' } }
    const effort = effortToReasoning(t.effort)
    if (effort) body.reasoning_effort = effort
    return body
  }
}

/**
 * 归一化 effort → DeepSeek reasoning_effort。官方仅 high/max 两档（low/medium→high，xhigh→max）。
 * 故本抽象层 low/medium 都给 high，high 给 max；无 effort 返回 undefined（不发、随默认 high）。
 */
function effortToReasoning(effort?: ThinkingEffort): 'high' | 'max' | undefined {
  switch (effort) {
    case 'high':
      return 'max'
    case 'low':
    case 'medium':
      return 'high'
    default:
      return undefined
  }
}
