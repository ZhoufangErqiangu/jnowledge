import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ContextItemState } from '@jnowledge/shared'
import { type ContextItemView, projectForChat, projectForUser } from './projection.js'

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
