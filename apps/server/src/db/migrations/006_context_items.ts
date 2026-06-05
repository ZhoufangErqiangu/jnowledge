import { type Kysely, sql } from 'kysely'

/**
 * 五期 模型自管理上下文：统一事件日志 context_items。
 * 取代 messages（用户视图）与 agent_steps（工具轨迹）——全量 append-only 唯一真相，
 * LLM 上下文与用户可见聊天都是它按 flag 派生的纯函数投影。
 *
 * 本迁移只建表 + 切换代码到新表；drop 旧表（messages/agent_steps）与 agent_runs 列改名
 * 留到 007，分两步降低回滚面。
 *
 * 设计要点：
 * - kind: user | assistant | tool_result（不设 tool_call——工具调用真相在 assistant.meta.toolCalls）。
 * - run_id 用 ON DELETE SET NULL：消息生命周期独立于 run；RAG 单轮路径 run_id 为 null。
 * - content 存「LLM 实际看到的字符串」（往返真相源）；带 toolCalls 无文本的中间 assistant 轮存 ''。
 * - meta(jsonb)：assistant 存 {toolCalls}；tool_result 存 {seq,name,toolCallId,ok,error,summary,output}。
 * - flags(jsonb)：{state:'active'|'hidden', pinned?, protected?, summarized?}；本期只写 active/hidden。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`now()`

  await db.schema
    .createTable('context_items')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('conversation_id', 'uuid', (c) =>
      c.notNull().references('conversations.id').onDelete('cascade'),
    )
    // run 删除不应连带删消息：消息独立于 run 存活。
    .addColumn('run_id', 'uuid', (c) => c.references('agent_runs.id').onDelete('set null'))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('content', 'text', (c) => c.notNull())
    .addColumn('citations', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('meta', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('flags', 'jsonb', (c) => c.notNull().defaultTo(sql`'{"state":"active"}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute()

  // 投影主查询：按会话取全量，(created_at, id) 全序（id 为 uuidv7 时间序，作同毫秒 tiebreak）。
  await db.schema
    .createIndex('context_items_conversation_idx')
    .on('context_items')
    .columns(['conversation_id', 'created_at', 'id'])
    .execute()

  // 诊断：按 run 取本次运行产生的全部条目。
  await db.schema.createIndex('context_items_run_idx').on('context_items').column('run_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('context_items').ifExists().execute()
}
