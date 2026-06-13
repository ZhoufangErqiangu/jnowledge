import {
  type ContextItemDebug,
  type ContextItemView,
  projectForChat,
  projectForUser,
} from '@jnowledge/shared'
import type { ContextItemRow } from '../../../models/contextItem.repo.js'
import type { AgentTurnMessage } from '../../infra/llm/types.js'

// projectForUser / projectForChat + ContextItemView 已下沉 @jnowledge/shared（DESIGN §8.9，
// server/client 共用单一投影）；此处再导出，保持既有 `from './projection.js'` 导入点不变。
// 带工具配对的真·LLM 视图投影（projectForLlm，依赖 infra 消息类型）仍留本文件。
export { projectForChat, projectForUser }
export type { ContextItemView }

/**
 * 投影引擎：把全量上下文事件日志（context_items）派生成两类视图，均为纯函数、可单测。
 * - LLM 视图（projectForLlm / projectForChat）：喂给模型推理的消息序列。
 * - 用户视图（projectForUser）：前端可见的聊天记录（保持现有 Message DTO 形状）。
 *
 * v2 契约（跨轮无损重建）：projectForLlm 回放 active 的 user/assistant/tool_result，
 * 含 assistant 的 toolCalls 与对应的 tool 消息——这样上一轮工具拿到的事实（如 list_collections
 * 返回的库 id）能带进下一轮，模型不必凭空臆造。配对约束（OpenAI：assistant.tool_calls 必须紧跟
 * 对应的 tool 回复）由「块」保证：assistant(toolCalls)+其 tool 回复构成一个原子块，预算裁剪以整块
 * 为单位，绝不把一组拆散而留下悬空 tool 消息。无对应 tool 回复的 toolCall 会被剔除（防御 400）。
 *
 * projectForChat（RAG 单轮 / 调试推理视图）仍是文本近似：ChatMessage 无 tool 角色，只回放
 * user/assistant 文本。
 *
 * 已知近似（不处理）：历史 assistant 文本里的引用标记 [n] 是「当时那一轮」的语义，与当前轮工具
 * 重新分配的 [n] 可能撞号。靠 system prompt「凡引用必标注」让模型在当前轮重新标注，不做跨轮
 * marker 重映射（成本过高）。
 */

/**
 * Kysely 行 → 原始上下文线格式条目（ContextItemDebug）：未过滤、含 meta/flags/runId，
 * SSE 流（recorder emit）与会话详情（getConversation）的 raw 共用此映射，保证 live 条目与 DB 回放同形。
 */
export function toContextItemDebug(r: ContextItemRow): ContextItemDebug {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    runId: r.run_id,
    kind: r.kind,
    content: r.content,
    citations: r.citations ?? [],
    meta: (r.meta ?? {}) as Record<string, unknown>,
    flags: r.flags ?? { state: 'active' },
    createdAt: r.created_at.toISOString(),
  }
}

/** Kysely 行 → 投影输入视图（jsonb 列已由 pg 解析为 JS 值）。createdAt 转 ISO 字符串（跨平台契约）。 */
export function toContextItemView(r: ContextItemRow): ContextItemView {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    kind: r.kind,
    content: r.content,
    citations: r.citations ?? [],
    ...(r.meta?.reasoning ? { reasoning: r.meta.reasoning } : {}),
    ...(r.meta?.toolCalls ? { toolCalls: r.meta.toolCalls } : {}),
    ...(r.meta?.toolCallId ? { toolCallId: r.meta.toolCallId } : {}),
    flags: r.flags ?? { state: 'active' },
    createdAt: r.created_at.toISOString(),
  }
}

/**
 * 跨轮重建的原子块：要么是单条 user，要么是单条「终答/文本」assistant，
 * 要么是 assistant(toolCalls) + 其全部 tool 回复（必须整组进出，保 OpenAI 配对约束）。
 */
interface LlmBlock {
  chars: number
  msgs: AgentTurnMessage[]
}

/** active 的 user/assistant/tool_result → 配对完整的原子块序列（保序）。 */
function llmBlocks(items: ContextItemView[]): LlmBlock[] {
  const blocks: LlmBlock[] = []
  // 当前「等待 tool 回复」的 assistant(toolCalls) 块；遇到下一条 user/assistant 即关闭。
  let open: LlmBlock | null = null

  for (const it of items) {
    if (it.flags.state !== 'active') continue

    if (it.kind === 'user') {
      open = null
      blocks.push({ chars: it.content.length, msgs: [{ role: 'user', content: it.content }] })
    } else if (it.kind === 'assistant') {
      open = null
      const calls = it.toolCalls && it.toolCalls.length > 0 ? it.toolCalls : undefined
      // 既无文本又无工具调用的空轮：跳过。
      if (it.content.length === 0 && !calls) continue
      const msg: AgentTurnMessage = calls
        ? it.content.length > 0
          ? { role: 'assistant', content: it.content, toolCalls: calls }
          : { role: 'assistant', toolCalls: calls }
        : { role: 'assistant', content: it.content }
      const block: LlmBlock = { chars: it.content.length, msgs: [msg] }
      blocks.push(block)
      if (calls) open = block // 收集随后的 tool 回复
    } else if (it.kind === 'tool_result') {
      // 仅当有配对的 assistant(toolCalls) 时回放；否则丢弃（孤立 tool 消息会触发 OpenAI 400）。
      if (!it.toolCallId || !open) continue
      open.msgs.push({ role: 'tool', toolCallId: it.toolCallId, content: it.content })
      open.chars += it.content.length
    }
  }

  return blocks.filter(reconcileBlock)
}

/**
 * 配对收尾：assistant.tool_calls 里每个 id 都必须有对应的 tool 回复，否则 OpenAI 400。
 * - 剔除没有 tool 回复的 toolCall（及反向的孤立 tool 消息，防御）。
 * - 若剔除后既无 toolCalls 又无文本 → 丢弃整块（返回 false）；仅剩文本则退化成普通 assistant 块。
 */
function reconcileBlock(b: LlmBlock): boolean {
  const head = b.msgs[0]
  if (!head || head.role !== 'assistant' || !head.toolCalls) return true // user / 普通 assistant 块

  const replied = new Set(
    b.msgs.flatMap((m) => (m.role === 'tool' ? [m.toolCallId] : [])),
  )
  const calls = head.toolCalls.filter((tc) => replied.has(tc.id))
  const callIds = new Set(calls.map((c) => c.id))
  b.msgs = b.msgs.filter((m) => m.role !== 'tool' || callIds.has(m.toolCallId))

  if (calls.length === 0) {
    if (head.content && head.content.length > 0) {
      b.msgs = [{ role: 'assistant', content: head.content }]
      return true
    }
    return false
  }
  b.msgs[0] =
    head.content && head.content.length > 0
      ? { role: 'assistant', content: head.content, toolCalls: calls }
      : { role: 'assistant', toolCalls: calls }
  return true
}

/** 整块预算裁剪：从最新往旧累加块字符数，超预算即停（至少保留最新一块＝本轮 user）。 */
function trimBlocks(blocks: LlmBlock[], budget: number): LlmBlock[] {
  let used = 0
  const kept: LlmBlock[] = []
  for (let i = blocks.length - 1; i >= 0; i--) {
    used += blocks[i]!.chars
    if (used > budget && kept.length > 0) break
    kept.push(blocks[i]!)
  }
  return kept.reverse()
}

/**
 * LLM 视图（agent ReAct）：[system?, ...预算内历史块, scopeSuffix?(贴最新 user 轮)]。
 * 本轮 user 已在 items 中（service 先落库），是最后一块。跨轮回放工具回合（assistant.toolCalls
 * + tool 回复），上一轮工具拿到的事实带进本轮。
 *
 * scopeSuffix（易变作用域后缀，见 systemPrompt.buildScopeSuffix）作为独立 system 消息插在
 * **最新 user 轮之前**：稳定 system + 历史构成可缓存前缀，作用域变化只让此尾部失效（实测 ~93%
 * 命中 vs 放前缀中间的 0%）。它是每轮重新生成的临时注入、不进历史，故不参与 items/块裁剪。
 */
export function projectForLlm(
  items: ContextItemView[],
  opts: { system?: string; scopeSuffix?: string; budget: number },
): AgentTurnMessage[] {
  const blocks = trimBlocks(llmBlocks(items), opts.budget)
  const messages: AgentTurnMessage[] = []
  if (opts.system !== undefined) messages.push({ role: 'system', content: opts.system })
  for (const b of blocks) messages.push(...b.msgs)
  // 后缀插在最后一块（本轮 user）之前；若无历史块则置于 system 之后、序末。
  if (opts.scopeSuffix) {
    const lastBlockLen = blocks.length > 0 ? blocks[blocks.length - 1]!.msgs.length : 0
    messages.splice(messages.length - lastBlockLen, 0, {
      role: 'system',
      content: opts.scopeSuffix,
    })
  }
  return messages
}
