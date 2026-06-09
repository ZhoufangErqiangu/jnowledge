import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ContextItemState } from '@jnowledge/shared'
import type { ToolCall } from '../llm/types.js'
import { type ContextItemView, projectForChat, projectForLlm, projectForUser } from './projection.js'

/**
 * 锁死第三状态不变式（DESIGN §8.3 / PLAN §14 DoD）：
 * - active 进 LLM 视图与用户视图；
 * - hidden（人工降级）与 internal（系统子推理留痕）进 raw 但不进任一视图；
 * - 关键：internal 的 assistant 轮（子 agent 产物）也绝不污染用户视图。
 */

let seq = 0
function item(
  kind: ContextItemView['kind'],
  content: string,
  state: ContextItemState,
): ContextItemView {
  seq += 1
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    conversationId: 'c1',
    kind,
    content,
    citations: [],
    flags: { state },
    createdAt: new Date(seq * 1000),
  }
}

const items: ContextItemView[] = [
  item('user', 'active-user', 'active'),
  item('assistant', 'active-assistant', 'active'),
  item('user', 'hidden-user', 'hidden'),
  item('assistant', 'internal-subagent-assistant', 'internal'),
  item('tool_result', 'internal-safety-verdict', 'internal'),
]

test('projectForChat: 仅 active 的 user/assistant 进 LLM 视图', () => {
  const llm = projectForChat(items, 1_000_000)
  const contents = llm.map((m) => m.content)
  assert.deepEqual(contents, ['active-user', 'active-assistant'])
  // hidden 与 internal 一律不在
  assert.ok(!contents.includes('hidden-user'))
  assert.ok(!contents.includes('internal-subagent-assistant'))
  assert.ok(!contents.includes('internal-safety-verdict'))
})

test('projectForUser: 仅 active 的 user/assistant 进用户视图（internal assistant 不污染）', () => {
  const view = projectForUser(items)
  const contents = view.map((m) => m.content)
  assert.deepEqual(contents, ['active-user', 'active-assistant'])
  // 第三状态的关键保证：assistant-kind 的 internal 子推理也被排除
  assert.ok(!contents.includes('internal-subagent-assistant'))
  assert.ok(!contents.includes('hidden-user'))
})

/**
 * v2 跨轮工具回放（projectForLlm）：
 * - assistant.toolCalls + 对应 tool 回复跨轮重建（上一轮工具拿到的事实带进下一轮）；
 * - 整块预算裁剪：绝不留下悬空 tool 消息；
 * - 无配对 tool 回复的 toolCall 被剔除（防 OpenAI 400）；internal 一律不进。
 */
function itemFull(p: Partial<ContextItemView> & { kind: ContextItemView['kind']; content: string }): ContextItemView {
  seq += 1
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    conversationId: 'c1',
    citations: [],
    flags: { state: 'active' },
    createdAt: new Date(seq * 1000),
    ...p,
  }
}
const tc = (id: string, name: string, args: unknown = {}): ToolCall => ({ id, name, arguments: args })

test('projectForLlm: 跨轮回放 assistant.toolCalls + tool 回复（事实带进下一轮）', () => {
  const items: ContextItemView[] = [
    itemFull({ kind: 'user', content: '上一轮问题' }),
    itemFull({ kind: 'assistant', content: '', toolCalls: [tc('call_1', 'list_collections')] }),
    itemFull({ kind: 'tool_result', content: '库 id=COL-REAL-123', toolCallId: 'call_1' }),
    itemFull({ kind: 'assistant', content: '上一轮答案' }),
    itemFull({ kind: 'user', content: '本轮追问' }),
  ]
  const msgs = projectForLlm(items, { system: 'SYS', budget: 1_000_000 })
  assert.deepEqual(msgs, [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: '上一轮问题' },
    { role: 'assistant', toolCalls: [tc('call_1', 'list_collections')] },
    { role: 'tool', toolCallId: 'call_1', content: '库 id=COL-REAL-123' },
    { role: 'assistant', content: '上一轮答案' },
    { role: 'user', content: '本轮追问' },
  ])
})

test('projectForLlm: 整块预算裁剪——绝不留下悬空 tool 消息', () => {
  const big = 'X'.repeat(500)
  const items: ContextItemView[] = [
    itemFull({ kind: 'assistant', content: '', toolCalls: [tc('call_a', 'knowledge_search')] }),
    itemFull({ kind: 'tool_result', content: big, toolCallId: 'call_a' }),
    itemFull({ kind: 'user', content: '本轮' }),
  ]
  // 预算只够留最新一块（user）。上一块（assistant+tool）整组被裁，不能只裁 assistant 留下孤儿 tool。
  const msgs = projectForLlm(items, { budget: 50 })
  assert.deepEqual(msgs, [{ role: 'user', content: '本轮' }])
  assert.ok(!msgs.some((m) => m.role === 'tool'))
})

test('projectForLlm: 无配对回复的 toolCall 被剔除', () => {
  const items: ContextItemView[] = [
    itemFull({ kind: 'assistant', content: '查一下', toolCalls: [tc('call_a', 't'), tc('call_b', 't')] }),
    itemFull({ kind: 'tool_result', content: 'a 的结果', toolCallId: 'call_a' }),
    // call_b 没有 tool 回复（如其结果是 internal/缺失）
  ]
  const msgs = projectForLlm(items, { budget: 1_000_000 })
  const asst = msgs.find((m) => m.role === 'assistant') as { toolCalls?: ToolCall[] }
  assert.deepEqual(asst.toolCalls?.map((c) => c.id), ['call_a'])
  const tools = msgs.filter((m) => m.role === 'tool')
  assert.equal(tools.length, 1)
})

test('projectForLlm: internal tool_result（子推理留痕）不回放', () => {
  const items: ContextItemView[] = [
    itemFull({ kind: 'assistant', content: '', toolCalls: [tc('call_x', 'knowledge_search')] }),
    itemFull({ kind: 'tool_result', content: 'rag_filter 留痕', toolCallId: 'call_x', flags: { state: 'internal' } }),
    itemFull({ kind: 'tool_result', content: '真实命中', toolCallId: 'call_x' }),
    itemFull({ kind: 'user', content: '本轮' }),
  ]
  const msgs = projectForLlm(items, { budget: 1_000_000 })
  assert.ok(!msgs.some((m) => m.role === 'tool' && m.content.includes('rag_filter')))
  assert.ok(msgs.some((m) => m.role === 'tool' && m.content === '真实命中'))
})

test('projectForLlm: scopeSuffix 作为独立 system 插在最新 user 轮之前（缓存友好）', () => {
  const items: ContextItemView[] = [
    itemFull({ kind: 'user', content: '上一轮问题' }),
    itemFull({ kind: 'assistant', content: '上一轮答案' }),
    itemFull({ kind: 'user', content: '本轮追问' }),
  ]
  const msgs = projectForLlm(items, { system: 'SYS', scopeSuffix: '当前作用域：库A', budget: 1_000_000 })
  assert.deepEqual(msgs, [
    { role: 'system', content: 'SYS' }, // 稳定前缀置最前
    { role: 'user', content: '上一轮问题' },
    { role: 'assistant', content: '上一轮答案' },
    { role: 'system', content: '当前作用域：库A' }, // 易变后缀贴最新 user 轮之前
    { role: 'user', content: '本轮追问' },
  ])
})

test('projectForLlm: 无 scopeSuffix 时消息序不变（向后兼容）', () => {
  const items: ContextItemView[] = [itemFull({ kind: 'user', content: '本轮' })]
  const msgs = projectForLlm(items, { system: 'SYS', budget: 1_000_000 })
  assert.deepEqual(msgs, [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: '本轮' },
  ])
})
