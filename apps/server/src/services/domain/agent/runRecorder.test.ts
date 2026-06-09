import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  ContextItemRepo,
  ContextItemRow,
  NewContextItem,
} from '../../../models/contextItem.repo.js'
import { createRunRecorder } from './runRecorder.js'

/**
 * RunRecorder 单测：锁住子 run 落库的两条不变式（DESIGN §8.3/§8.4 / PLAN §14.3）：
 * ① 子 run 全过程以第三状态 internal 落库（不进 LLM/用户视图）；
 * ② 所有条目挂在分配给该 run 的（独立）runId 上 —— 子 run 与父 run 的 runId 分离。
 * 另测 step_start→tool_result 的 seq→input 关联与逐轮思考过程归属。
 */

/** 捕获 insert 的假 repo；finalAssistant 只读返回行的 id。 */
function fakeRepo(): { repo: ContextItemRepo; inserts: NewContextItem[] } {
  const inserts: NewContextItem[] = []
  const repo = {
    async insert(item: NewContextItem): Promise<ContextItemRow> {
      inserts.push(item)
      return { id: item.id } as ContextItemRow
    },
    async listByConversation() {
      return []
    },
    async listByRun() {
      return []
    },
  } as unknown as ContextItemRepo
  return { repo, inserts }
}

test('子 run：全过程以 internal 落库，且都挂在该 run 的独立 runId 上', async () => {
  const { repo, inserts } = fakeRepo()
  const rec = createRunRecorder(repo, {
    conversationId: 'conv-1',
    runId: 'child-run',
    state: 'internal',
  })

  rec.addReasoning('思考A')
  await rec.assistant({ type: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'foo', arguments: {} }] })
  rec.noteInput(1, { q: 'hello' })
  await rec.toolResult({
    type: 'tool_result',
    seq: 1,
    kind: 'tool',
    name: 'foo',
    toolCallId: 't1',
    ok: true,
    summary: 'done',
    output: 'OUTPUT',
  })
  await rec.finalAssistant('最终答复', [])

  // ① 全部 internal、② 全部挂 child-run
  assert.equal(inserts.length, 3)
  assert.ok(inserts.every((it) => it.flags?.state === 'internal'))
  assert.ok(inserts.every((it) => it.runId === 'child-run'))
  assert.ok(inserts.every((it) => it.conversationId === 'conv-1'))

  // 思考过程归属到紧随的 assistant 轮
  const [assistantTurn, toolResult, final] = inserts
  assert.equal(assistantTurn!.kind, 'assistant')
  assert.equal(assistantTurn!.meta?.reasoning, '思考A')
  assert.deepEqual(assistantTurn!.meta?.toolCalls, [{ id: 't1', name: 'foo', arguments: {} }])

  // tool_result：content=LLM 实际所见字符串；meta.input 来自 noteInput 的 seq 关联
  assert.equal(toolResult!.kind, 'tool_result')
  assert.equal(toolResult!.content, 'OUTPUT')
  assert.deepEqual(toolResult!.meta?.input, { q: 'hello' })
  assert.equal(toolResult!.meta?.seq, 1)

  // 终答：reasoning 已被前面的 assistant 轮消费，不重复挂到终答
  assert.equal(final!.kind, 'assistant')
  assert.equal(final!.content, '最终答复')
  assert.equal(final!.meta?.reasoning, undefined)
})

test('顶层 run：state=active（进视图）', async () => {
  const { repo, inserts } = fakeRepo()
  const rec = createRunRecorder(repo, {
    conversationId: 'conv-1',
    runId: 'top-run',
    state: 'active',
  })
  await rec.finalAssistant('答复', [])
  assert.equal(inserts[0]!.flags?.state, 'active')
  assert.equal(inserts[0]!.runId, 'top-run')
})
