import type { Citation, ContextItemKind, Message } from '@jnowledge/shared'
import type { ContextItemFlags, ContextItemRow } from '../../../models/contextItem.repo.js'
import type { AgentTurnMessage, ChatMessage } from '../llm/types.js'

/**
 * 投影引擎：把全量上下文事件日志（context_items）派生成两类视图，均为纯函数、可单测。
 * - LLM 视图（projectForLlm / projectForChat）：喂给模型推理的消息序列。
 * - 用户视图（projectForUser）：前端可见的聊天记录（保持现有 Message DTO 形状）。
 *
 * v1 契约（写死，规避 OpenAI 的 tool_calls/tool 配对约束）：
 * - 只回放 active 且 kind∈{user,assistant} 的条目；assistant **强制剥离 toolCalls**、
 *   tool_result **整条跳过**（轮内工具消息由 runtime 现场维护在内存，跨轮不重建）。
 * - 剥离 toolCalls 后 content 为空的 assistant 轮直接跳过。
 *
 * 已知近似（v1 不处理）：历史 assistant 文本里的引用标记 [n] 是「当时那一轮」的语义，
 * 与当前轮工具重新分配的 [n] 可能撞号。靠 system prompt「凡引用必标注」让模型在当前轮
 * 重新标注，不做跨轮 marker 重映射（成本过高）。
 */

/** 投影输入：与 Kysely Row 解耦的最小视图（camelCase）。 */
export interface ContextItemView {
  id: string
  conversationId: string
  kind: ContextItemKind
  content: string
  citations: Citation[]
  /** assistant 轮思考过程（meta.reasoning），仅用户视图展示用。 */
  reasoning?: string
  flags: ContextItemFlags
  createdAt: Date
}

/** Kysely 行 → 投影输入视图（jsonb 列已由 pg 解析为 JS 值）。 */
export function toContextItemView(r: ContextItemRow): ContextItemView {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    kind: r.kind,
    content: r.content,
    citations: r.citations ?? [],
    ...(r.meta?.reasoning ? { reasoning: r.meta.reasoning } : {}),
    flags: r.flags ?? { state: 'active' },
    createdAt: r.created_at,
  }
}

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
    // tool_result：跨轮不回放。
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

/** LLM 视图（agent ReAct）：[system?, ...预算内历史]。本轮 user 已在 items 中（service 先落库）。 */
export function projectForLlm(
  items: ContextItemView[],
  opts: { system?: string; budget: number },
): AgentTurnMessage[] {
  const history = trimByBudget(historyTurns(items), opts.budget)
  const messages: AgentTurnMessage[] = []
  if (opts.system !== undefined) messages.push({ role: 'system', content: opts.system })
  messages.push(...history)
  return messages
}

/** LLM 视图（RAG 单轮）：仅历史（不含 system——RAG 的 system 由 textStream 单独传）。 */
export function projectForChat(items: ContextItemView[], budget: number): ChatMessage[] {
  return trimByBudget(historyTurns(items), budget)
}

/** 用户视图：active 的 user/assistant → 现有 Message DTO（前端不变）。tool_result 不可见。 */
export function projectForUser(items: ContextItemView[]): Message[] {
  const messages: Message[] = []
  for (const it of items) {
    // 同 historyTurns：只有 active 进用户视图；hidden / internal 均不可见。
    if (it.flags.state !== 'active') continue
    if (it.kind !== 'user' && it.kind !== 'assistant') continue
    messages.push({
      id: it.id,
      conversationId: it.conversationId,
      role: it.kind,
      content: it.content,
      ...(it.reasoning ? { reasoning: it.reasoning } : {}),
      citations: it.citations,
      createdAt: it.createdAt.toISOString(),
    })
  }
  return messages
}
