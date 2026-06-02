import { sql, type Selectable } from 'kysely'
import type { DB } from '../db/index.js'
import type { ConversationsTable } from '../db/types.js'

export type ConversationRow = Selectable<ConversationsTable>

export interface NewConversation {
  id: string
  collectionId: string
  title: string
  createdBy: string
}

export function createConversationRepo(db: DB) {
  return {
    async findById(id: string): Promise<ConversationRow | undefined> {
      return db
        .selectFrom('conversations')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    },

    async listByCollection(collectionId: string, createdBy: string): Promise<ConversationRow[]> {
      return db
        .selectFrom('conversations')
        .selectAll()
        .where('collection_id', '=', collectionId)
        .where('created_by', '=', createdBy)
        .where('deleted_at', 'is', null)
        .orderBy('updated_at', 'desc')
        .execute()
    },

    async insert(cv: NewConversation): Promise<ConversationRow> {
      return db
        .insertInto('conversations')
        .values({
          id: cv.id,
          collection_id: cv.collectionId,
          title: cv.title,
          created_by: cv.createdBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },

    async setTitle(id: string, title: string): Promise<void> {
      await db
        .updateTable('conversations')
        .set({ title, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },

    /** 提问/回答后顺带刷新 updated_at，使会话列表按最近活跃排序。 */
    async touch(id: string): Promise<void> {
      await db
        .updateTable('conversations')
        .set({ updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },

    async softDelete(id: string): Promise<void> {
      await db
        .updateTable('conversations')
        .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },
  }
}

export type ConversationRepo = ReturnType<typeof createConversationRepo>
