import '../loadEnv.js'
import { sql } from 'kysely'
import { type RawContextStreamEvent, projectForUser, viewFromDebug } from '@jnowledge/shared'
import { loadConfig } from '../config/index.js'
import { buildContainer } from '../container.js'
import type { Principal } from '../services/domain/collection.service.js'

/**
 * 端到端验证「模型自管理上下文 v1：多轮记忆」。
 * 真实 DB + 真实 LLM：同一会话连问两轮——第一轮告知一个事实，第二轮让 agent 回忆。
 * 第二轮能答出第一轮的事实 = 跨轮上下文确实经投影喂进了 runtime（迁移前完全做不到）。
 * 同时打印 context_items 全量持久化情况（user/assistant/tool_result 各 kind）。
 *
 * 运行：pnpm --filter @jnowledge/server exec tsx src/scripts/e2eContextMemory.ts
 */
// 新 wire 格式（DESIGN §8.9）：答案以顶层「终答 item」（active assistant、无 toolCalls）的 content 为准。
async function drain(stream: AsyncIterable<RawContextStreamEvent>) {
  let answer = ''
  let error: string | undefined
  for await (const ev of stream) {
    if (ev.type === 'item') {
      const { item } = ev
      const toolCalls = (item.meta as { toolCalls?: unknown[] }).toolCalls
      if (item.kind === 'assistant' && item.flags.state === 'active' && !(toolCalls?.length ?? 0)) {
        answer = item.content
      }
    } else if (ev.type === 'error') {
      error = ev.message
    }
  }
  return { answer, error }
}

async function main() {
  const c = buildContainer(loadConfig())
  const { services, models, db, infra } = c

  if (!infra.llm.chat.configured) {
    console.error('✗ 未配置 chat 供应商（.env），无法验证多轮记忆。')
    await db.destroy()
    process.exit(1)
  }

  const admin = await models.users.findByEmail('admin@admin.com')
  if (!admin) {
    console.error('✗ 找不到引导管理员用户，先跑一次 pnpm migrate。')
    await db.destroy()
    process.exit(1)
  }
  const principal: Principal = { uid: admin.id, role: admin.role }

  // 全局会话（不绑库）→ GLOBAL_ASSISTANT；闲聊类问题应直接回答、无需检索。
  const cv = await services.chat.createConversation(principal, { title: 'E2E 记忆测试' })
  console.log(`· 会话 ${cv.id}`)

  const SECRET = '42'
  const turn1 = await drain(
    services.agent.ask(principal, cv.id, `请记住：我的幸运数字是 ${SECRET}。简短确认即可。`),
  )
  console.log(`\n【第一轮·告知】\n${turn1.answer.trim()}`)
  if (turn1.error) throw new Error(`第一轮出错：${turn1.error}`)

  const turn2 = await drain(
    services.agent.ask(principal, cv.id, '我刚才告诉你的幸运数字是多少？只回答那个数字。'),
  )
  console.log(`\n【第二轮·回忆】\n${turn2.answer.trim()}`)
  if (turn2.error) throw new Error(`第二轮出错：${turn2.error}`)

  // 持久化检查：context_items 全量落库。
  const rows = await sql<{ kind: string; n: string }>`
    SELECT kind, count(*)::text AS n FROM context_items
    WHERE conversation_id = ${cv.id} GROUP BY kind ORDER BY kind`.execute(db)
  console.log(
    `\n· context_items 落库：${rows.rows.map((r) => `${r.kind}×${r.n}`).join(', ') || '(空)'}`,
  )

  const remembered = turn2.answer.includes(SECRET)
  console.log(`\n${remembered ? '✓ PASS' : '✗ FAIL'} — 第二轮${remembered ? '记得' : '没记住'}第一轮的事实（${SECRET}）`)

  // 阶段 4（完全对称）：reload 下发 raw + runs；前端跑共享 projectForUser 派生用户视图。
  const detail = await services.chat.getConversation(principal, cv.id)
  const clientMsgs = projectForUser(detail.raw.map(viewFromDebug))
  const reloadOk =
    detail.raw.length > 0 &&
    detail.runs.length > 0 &&
    clientMsgs.filter((m) => m.role === 'user').length === 2 &&
    clientMsgs.some((m) => m.role === 'assistant' && m.content.includes(SECRET))
  console.log(
    `· reload 对称：raw×${detail.raw.length} runs×${detail.runs.length} → 客户端投影 ${clientMsgs.length} 条消息（user/assistant 各 ${clientMsgs.filter((m) => m.role === 'user').length}/${clientMsgs.filter((m) => m.role === 'assistant').length}）`,
  )
  console.log(`${reloadOk ? '✓ PASS' : '✗ FAIL'} — getConversation 下发 raw+runs，共享投影重建用户视图含事实`)

  // ── 场景 B：工具调用轮的全量持久化 + 跨轮投影不被工具轮破坏 ──
  console.log('\n──────── 场景 B：工具轮持久化 ────────')
  const cvb = await services.chat.createConversation(principal, { title: 'E2E 工具轮测试' })
  console.log(`· 会话 ${cvb.id}`)
  // 全局会话里问「有哪些知识库」→ 触发 list_collections 工具。
  const t1 = await drain(services.agent.ask(principal, cvb.id, '我能访问哪些知识库？列出来。'))
  console.log(`\n【B·第一轮（触发工具）】\n${t1.answer.trim().slice(0, 200)}`)
  if (t1.error) throw new Error(`B 第一轮出错：${t1.error}`)

  // 检查工具轮持久化：assistant(meta.toolCalls) + tool_result(meta.toolCallId/name/ok)。
  const itemsB = await models.contextItems.listByConversation(cvb.id)
  const toolResults = itemsB.filter((i) => i.kind === 'tool_result')
  const asstWithCalls = itemsB.filter(
    (i) => i.kind === 'assistant' && Array.isArray(i.meta?.toolCalls) && i.meta.toolCalls.length > 0,
  )
  console.log(
    `· 落库：${['user', 'assistant', 'tool_result']
      .map((k) => `${k}×${itemsB.filter((i) => i.kind === k).length}`)
      .join(', ')}`,
  )
  for (const tr of toolResults) {
    console.log(
      `  tool_result: name=${tr.meta?.name} toolCallId=${tr.meta?.toolCallId ? '✓' : '✗缺失'} ok=${tr.meta?.ok}`,
    )
  }

  // 跨轮：紧接一轮普通追问——若投影没正确剥离上一轮的 toolCalls，会触发供应商配对 400。
  const t2 = await drain(services.agent.ask(principal, cvb.id, '谢谢，简单总结一句你刚才做了什么。'))
  console.log(`\n【B·第二轮（跨工具轮）】\n${t2.answer.trim().slice(0, 200)}`)
  const toolTurnOk = toolResults.length > 0 && asstWithCalls.length > 0 && !t2.error
  console.log(
    `\n${toolTurnOk ? '✓ PASS' : '✗ FAIL'} — 工具轮全量持久化${toolResults.length ? '✓' : '✗'} / assistant.toolCalls 落库${asstWithCalls.length ? '✓' : '✗'} / 跨工具轮无配对错误${t2.error ? `✗(${t2.error})` : '✓'}`,
  )

  // 清理两个测试会话（软删）。
  await services.chat.removeConversation(principal, cv.id)
  await services.chat.removeConversation(principal, cvb.id)
  await db.destroy()
  process.exit(remembered && toolTurnOk && reloadOk ? 0 : 1)
}

main().catch(async (err) => {
  console.error('✗ 测试异常：', err)
  process.exit(1)
})
