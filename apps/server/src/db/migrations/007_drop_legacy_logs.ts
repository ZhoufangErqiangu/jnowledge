import { type Kysely, sql } from 'kysely'

/**
 * 五期收尾：context_items 上线后，弃用被它取代的两张表。
 * - messages：用户视图改由 context_items 投影派生（projectForUser）。
 * - agent_steps：工具轨迹并入 context_items（kind=tool_result，诊断字段进 meta）。
 * 同时把 agent_runs.message_id（终答指针）改名为 final_item_id——现在指向 context_items 里的
 * 终答 assistant 条目。沿用 003 的「不设外键」约定（终答指针仅运行完成时回填，不做级联）。
 *
 * 分两步迁移（006 建表+切码，007 落清理）以降低回滚面。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('agent_steps').ifExists().execute()
  await db.schema.dropTable('messages').ifExists().execute()
  await db.schema.alterTable('agent_runs').renameColumn('message_id', 'final_item_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const now = sql`now()`

  await db.schema.alterTable('agent_runs').renameColumn('final_item_id', 'message_id').execute()

  // 重建 messages（镜像 002_rag）。
  await db.schema
    .createTable('messages')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('conversation_id', 'uuid', (c) =>
      c.notNull().references('conversations.id').onDelete('cascade'),
    )
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('content', 'text', (c) => c.notNull())
    .addColumn('citations', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute()
  await db.schema
    .createIndex('messages_conversation_idx')
    .on('messages')
    .columns(['conversation_id', 'created_at'])
    .execute()

  // 重建 agent_steps（镜像 003_agent）。
  await db.schema
    .createTable('agent_steps')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('run_id', 'uuid', (c) => c.notNull().references('agent_runs.id').onDelete('cascade'))
    .addColumn('seq', 'integer', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('name', 'text')
    .addColumn('input', 'jsonb')
    .addColumn('output', 'jsonb')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute()
  await db.schema.createIndex('agent_steps_run_idx').on('agent_steps').columns(['run_id', 'seq']).execute()
}
