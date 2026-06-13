import type { LlmViewMessage } from '../schemas/chat.js'
import type { ContextItemView } from './userView.js'

/**
 * 推理视图投影（文本近似）：真相源（原始上下文条目）→ 跨轮「人类对话」历史，纯函数、跨平台。
 *
 * 与 `projectForUser` 同源同构（DESIGN §8.2 / §8.9）：由前端（debug 页从 raw 派生）直接消费，
 * 不再走服务端 debug 端点重算。这是文本近似——只回放 active 的 user/assistant 文本，不含 system、
 * 不含工具回合（tool_calls / tool 回复）；真正喂给 agent 的带工具配对的 LLM 视图（projectForLlm）
 * 依赖服务端 infra 消息类型，仍留服务端。
 */

/** 跨轮历史投影进 LLM 上下文的字符预算（调试推理视图默认值）。 */
export const HISTORY_CHAR_BUDGET = 60_000

/** 历史里可进 LLM 的「人类对话」对（user/assistant 文本），已按 flag 与空文本过滤。 */
interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

function historyTurns(items: ContextItemView[]): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  for (const it of items) {
    // 只有 active 进 LLM 视图；hidden（人工降级）与 internal（系统子推理留痕）一律排除。
    if (it.flags.state !== 'active') continue
    if (it.kind === 'user') {
      turns.push({ role: 'user', content: it.content })
    } else if (it.kind === 'assistant') {
      // 强制剥离 toolCalls：只取文本。空文本（纯工具调用轮）跳过。
      if (it.content.length > 0) turns.push({ role: 'assistant', content: it.content })
    }
    // tool_result：文本视图不回放。
  }
  return turns
}

/**
 * token 预算裁剪（按字符近似）：从最新往旧累加，超预算则丢弃更旧的历史。
 * system 由调用方前置、不计入此预算。
 */
function trimByBudget<T extends { content: string }>(turns: T[], budget: number): T[] {
  let used = 0
  const kept: T[] = []
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!
    used += turn.content.length
    if (used > budget && kept.length > 0) break
    kept.push(turn)
  }
  return kept.reverse()
}

/** 推理视图（调试用文本近似）：仅 user/assistant 文本（不含 system、不含工具回合）。 */
export function projectForChat(
  items: ContextItemView[],
  budget: number = HISTORY_CHAR_BUDGET,
): LlmViewMessage[] {
  return trimByBudget(historyTurns(items), budget)
}
