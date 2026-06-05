import type { Selectable } from 'kysely'
import type { Citation, ContextItemFlags, ContextItemKind, ContextItemMeta } from '@jnowledge/shared'
import type { DB } from '../db/index.js'
import type { ContextItemsTable } from '../db/types.js'

export type ContextItemRow = Selectable<ContextItemsTable>

export interface NewContextItem {
  id: string
  conversationId: string
  /** agent run 归属；RAG 单轮路径为 null。 */
  runId?: string | null
  kind: ContextItemKind
  content: string
  citations?: Citation[]
  meta?: ContextItemMeta
  /** 缺省 active（DB 默认）。 */
  flags?: ContextItemFlags
}

export function createContextItemRepo(db: DB) {
  return {
    /** 会话全量条目，按 (created_at, id) 全序——投影引擎据此重建视图。 */
    async listByConversation(conversationId: string): Promise<ContextItemRow[]> {
      return db
        .selectFrom('context_items')
        .selectAll()
        .where('conversation_id', '=', conversationId)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute()
    },

    /** 单次运行产生的全部条目（诊断用）。 */
    async listByRun(runId: string): Promise<ContextItemRow[]> {
      return db
        .selectFrom('context_items')
        .selectAll()
        .where('run_id', '=', runId)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute()
    },

    async insert(item: NewContextItem): Promise<ContextItemRow> {
      return db
        .insertInto('context_items')
        .values({
          id: item.id,
          conversation_id: item.conversationId,
          run_id: item.runId ?? null,
          kind: item.kind,
          content: item.content,
          // jsonb 需显式 JSON 序列化：node-postgres 会把 JS 数组/对象当成 PG 字面量，破坏 jsonb。
          citations: JSON.stringify(item.citations ?? []),
          meta: JSON.stringify(item.meta ?? {}),
          ...(item.flags ? { flags: JSON.stringify(item.flags) } : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },
  }
}

export type ContextItemRepo = ReturnType<typeof createContextItemRepo>
