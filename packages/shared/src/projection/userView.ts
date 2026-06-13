import type { ContextItemKind, ContextItemState } from '../constants/enums.js'
import type { Citation, ContextItemDebug, Message } from '../schemas/chat.js'

/**
 * 上下文投影：真相源（原始上下文条目）→ 用户视图，纯函数、跨平台（DESIGN §8.2 / §8.9）。
 *
 * 这是「投影下沉 shared」的落点：同一份 `projectForUser` 由服务端（reload / debug，输入来自
 * `toContextItemView(Row)`）与前端（live，输入来自流式原始上下文事件累积）**共用**，根除
 * 「两套投影漂移」。LLM 视图投影（projectForLlm / projectForChat）依赖服务端 infra 消息类型，
 * 留在服务端 `projection.ts`；本模块只承载跨平台部分。
 */

/** context_item.meta 里的工具调用形状（与服务端 ContextItemToolCall / runtime ToolCall 同形）。 */
export interface ContextItemToolCall {
  id: string
  name: string
  arguments: unknown
}

/** 派生视图所需的 flags（投影按 state 过滤；其余 flag 留位）。 */
export interface ContextItemFlags {
  state: ContextItemState
  pinned?: boolean
  protected?: boolean
  summarized?: boolean
}

/**
 * 投影输入：与持久化行解耦的最小上下文条目视图（camelCase，跨平台）。
 * 服务端由 `toContextItemView(Row)` 构造；前端由流式原始上下文事件累积构造（DESIGN §8.9）。
 * `createdAt` 用 ISO8601 字符串（与 `Message.createdAt` 一致、跨平台，非 `Date`）。
 */
export interface ContextItemView {
  id: string
  conversationId: string
  kind: ContextItemKind
  content: string
  citations: Citation[]
  /** assistant 轮思考过程（meta.reasoning），仅用户视图展示用。 */
  reasoning?: string
  /** assistant 轮本轮发起的工具调用（meta.toolCalls），跨轮无损重建用。 */
  toolCalls?: ContextItemToolCall[]
  /** tool_result 对应的工具调用 id（meta.toolCallId），跨轮重建配对用。 */
  toolCallId?: string
  flags: ContextItemFlags
  createdAt: string
}

/**
 * 原始上下文线格式条目（ContextItemDebug）→ 投影输入视图（ContextItemView）。
 * 前端把流式/回放拿到的 raw 条目经此转成投影输入，再跑 projectForUser（DESIGN §8.9）——
 * 与服务端 `toContextItemView(Row)` 对应，只是源是 wire DTO 而非 Kysely Row。
 */
export function viewFromDebug(d: ContextItemDebug): ContextItemView {
  const meta = d.meta as { reasoning?: unknown; toolCalls?: unknown; toolCallId?: unknown }
  return {
    id: d.id,
    conversationId: d.conversationId,
    kind: d.kind,
    content: d.content,
    citations: d.citations,
    ...(typeof meta.reasoning === 'string' ? { reasoning: meta.reasoning } : {}),
    ...(Array.isArray(meta.toolCalls)
      ? { toolCalls: meta.toolCalls as ContextItemToolCall[] }
      : {}),
    ...(typeof meta.toolCallId === 'string' ? { toolCallId: meta.toolCallId } : {}),
    flags: {
      state: d.flags.state,
      ...(d.flags.pinned !== undefined ? { pinned: d.flags.pinned } : {}),
      ...(d.flags.protected !== undefined ? { protected: d.flags.protected } : {}),
      ...(d.flags.summarized !== undefined ? { summarized: d.flags.summarized } : {}),
    },
    createdAt: d.createdAt,
  }
}

/** 用户视图：active 的 user/assistant → Message DTO。tool_result / hidden / internal 不可见。 */
export function projectForUser(items: ContextItemView[]): Message[] {
  const messages: Message[] = []
  for (const it of items) {
    // 只有 active 进用户视图；hidden（人工降级）与 internal（系统子推理留痕）均不可见。
    if (it.flags.state !== 'active') continue
    if (it.kind !== 'user' && it.kind !== 'assistant') continue
    messages.push({
      id: it.id,
      conversationId: it.conversationId,
      role: it.kind,
      content: it.content,
      ...(it.reasoning ? { reasoning: it.reasoning } : {}),
      citations: it.citations,
      createdAt: it.createdAt,
    })
  }
  return messages
}
