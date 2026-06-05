import { sql } from 'kysely'
import type { Selectable } from 'kysely'
import type { DB, DocumentsTable } from './schema.js'
import type { DocumentSourceType, DocumentStatus } from '@jnowledge/shared'

export type DocumentRow = Selectable<DocumentsTable>

export interface NewDocument {
  id: string
  collectionId: string
  title: string
  sourceType: DocumentSourceType
  status?: DocumentStatus
  createdBy: string
}

export function createDocumentRepo(db: DB) {
  return {
    async findById(id: string): Promise<DocumentRow | undefined> {
      return db
        .selectFrom('documents')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    },

    async listByCollection(
      collectionId: string,
      limit: number,
      offset: number,
    ): Promise<{ items: DocumentRow[]; total: number }> {
      const items = await db
        .selectFrom('documents')
        .selectAll()
        .where('collection_id', '=', collectionId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute()

      const { count } = await db
        .selectFrom('documents')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('collection_id', '=', collectionId)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow()

      return { items, total: Number(count) }
    },

    async insert(d: NewDocument): Promise<DocumentRow> {
      return db
        .insertInto('documents')
        .values({
          id: d.id,
          collection_id: d.collectionId,
          title: d.title,
          source_type: d.sourceType,
          ...(d.status ? { status: d.status } : {}),
          created_by: d.createdBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },

    async setCurrentVersion(id: string, versionId: string): Promise<void> {
      await db
        .updateTable('documents')
        .set({ current_version_id: versionId, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },

    async setStatus(
      id: string,
      status: DocumentStatus,
      statusError: string | null = null,
    ): Promise<void> {
      await db
        .updateTable('documents')
        .set({ status, status_error: statusError, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },

    async setTitle(id: string, title: string): Promise<void> {
      await db
        .updateTable('documents')
        .set({ title, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },

    /** 跨库移动：改文档所属知识库（chunk/向量经 document_version 不动，检索作用域随之变化）。 */
    async setCollection(id: string, collectionId: string): Promise<void> {
      await db
        .updateTable('documents')
        .set({ collection_id: collectionId, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },

    async softDelete(id: string): Promise<void> {
      await db
        .updateTable('documents')
        .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },
  }
}

export type DocumentRepo = ReturnType<typeof createDocumentRepo>
