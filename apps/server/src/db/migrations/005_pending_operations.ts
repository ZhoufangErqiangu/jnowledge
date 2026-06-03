import { type Kysely, sql } from 'kysely'

/**
 * 写操作的两阶段确认：高风险增删改先落一条 pending，由 agent 转述用户；
 * 用户在「下一轮」确认后，带 confirmToken 重新发起方可执行（proposing_run_id ≠ 执行 run 防同轮绕过）。
 * args 存工具入参快照（jsonb）；token 一次性消费（status pending→confirmed）。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`now()`
  await db.schema
    .createTable('pending_operations')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('conversation_id', 'uuid', (c) =>
      c.notNull().references('conversations.id').onDelete('cascade'),
    )
    // 提出该提案的 run；执行时要求当前 run 与之不同（跨用户轮次）。
    .addColumn('proposing_run_id', 'uuid', (c) => c.notNull())
    .addColumn('tool_name', 'text', (c) => c.notNull())
    .addColumn('args', 'jsonb', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull())
    .addColumn('risk_reason', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute()

  await db.schema
    .createIndex('pending_operations_conversation_idx')
    .on('pending_operations')
    .columns(['conversation_id', 'status'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('pending_operations').ifExists().execute()
}
