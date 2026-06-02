import { type Kysely, sql } from 'kysely'

/**
 * 四期 Agent Runtime：运行 + 执行轨迹。
 * agent_runs 复用 conversations（ACL 复用 collection 成员关系），终答落 messages，
 * message_id 在 run 完成后回填；agent_steps 是 append-only 的轨迹（与 SSE 事件同形）。
 * 续跑(resume) 逻辑留后续期；本期只建表 + 落轨迹。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`now()`

  // 1) agent_runs：一次 agent 运行
  await db.schema
    .createTable('agent_runs')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('conversation_id', 'uuid', (c) =>
      c.notNull().references('conversations.id').onDelete('cascade'),
    )
    // 终答消息；run 完成回填，运行中为 null。不设外键 onDelete（消息删除走会话级联）。
    .addColumn('message_id', 'uuid')
    .addColumn('agent_name', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('running'))
    .addColumn('input', 'text', (c) => c.notNull())
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute()

  await db.schema
    .createIndex('agent_runs_conversation_idx')
    .on('agent_runs')
    .columns(['conversation_id', 'created_at'])
    .execute()

  // 2) agent_steps：执行轨迹（append-only）。input/output 为 jsonb。
  await db.schema
    .createTable('agent_steps')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('run_id', 'uuid', (c) =>
      c.notNull().references('agent_runs.id').onDelete('cascade'),
    )
    .addColumn('seq', 'integer', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('name', 'text')
    .addColumn('input', 'jsonb')
    .addColumn('output', 'jsonb')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute()

  await db.schema
    .createIndex('agent_steps_run_idx')
    .on('agent_steps')
    .columns(['run_id', 'seq'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('agent_steps').ifExists().execute()
  await db.schema.dropTable('agent_runs').ifExists().execute()
}
