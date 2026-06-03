import { type Kysely, sql } from 'kysely'

/**
 * 全局聊天：conversations.collection_id 改为可空。
 * NULL 表示全局会话——不绑任何知识库，仅走 agent 模式（先列库再选库跨库检索）。
 * 非 NULL 仍是知识库会话（RAG + 库内 agent），语义不变；FK 级联保持。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE conversations ALTER COLUMN collection_id DROP NOT NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 回滚前需保证无全局会话，否则违反 NOT NULL；这里先删全局会话再加约束。
  await sql`DELETE FROM conversations WHERE collection_id IS NULL`.execute(db)
  await sql`ALTER TABLE conversations ALTER COLUMN collection_id SET NOT NULL`.execute(db)
}
