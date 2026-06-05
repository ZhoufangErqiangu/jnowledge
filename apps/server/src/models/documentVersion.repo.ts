import type { Selectable } from 'kysely'
import type { DB, DocumentVersionsTable } from './schema.js'

export type DocumentVersionRow = Selectable<DocumentVersionsTable>

export interface NewDocumentVersion {
  id: string
  documentId: string
  versionNo: number
  content: string
  checksum: string
  sourceFileId?: string | null
  authorId: string
}

export function createDocumentVersionRepo(db: DB) {
  return {
    async findById(id: string): Promise<DocumentVersionRow | undefined> {
      return db
        .selectFrom('document_versions')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()
    },

    async listByDocument(documentId: string): Promise<DocumentVersionRow[]> {
      return db
        .selectFrom('document_versions')
        .selectAll()
        .where('document_id', '=', documentId)
        .orderBy('version_no', 'desc')
        .execute()
    },

    async nextVersionNo(documentId: string): Promise<number> {
      const row = await db
        .selectFrom('document_versions')
        .select((eb) => eb.fn.max('version_no').as('max'))
        .where('document_id', '=', documentId)
        .executeTakeFirst()
      return (row?.max ?? 0) + 1
    },

    async latestChecksum(documentId: string): Promise<string | undefined> {
      const row = await db
        .selectFrom('document_versions')
        .select('checksum')
        .where('document_id', '=', documentId)
        .orderBy('version_no', 'desc')
        .limit(1)
        .executeTakeFirst()
      return row?.checksum
    },

    async insert(v: NewDocumentVersion): Promise<DocumentVersionRow> {
      return db
        .insertInto('document_versions')
        .values({
          id: v.id,
          document_id: v.documentId,
          version_no: v.versionNo,
          content: v.content,
          checksum: v.checksum,
          source_file_id: v.sourceFileId ?? null,
          author_id: v.authorId,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },
  }
}

export type DocumentVersionRepo = ReturnType<typeof createDocumentVersionRepo>
