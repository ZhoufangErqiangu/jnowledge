import type { Selectable } from 'kysely'
import type { DB, FilesTable } from './schema.js'

export type FileRow = Selectable<FilesTable>

export interface NewFile {
  id: string
  storageBucket: string
  storageKey: string
  fileSize: number
  mimeType: string
  checksum: string
  originalName?: string | null
  createdBy: string
}

export function createFileRepo(db: DB) {
  return {
    async findById(id: string): Promise<FileRow | undefined> {
      return db
        .selectFrom('files')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    },

    /** 去重：按 checksum 找已存在的物理文件以复用。 */
    async findByChecksum(checksum: string): Promise<FileRow | undefined> {
      return db
        .selectFrom('files')
        .selectAll()
        .where('checksum', '=', checksum)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    },

    async insert(f: NewFile): Promise<FileRow> {
      return db
        .insertInto('files')
        .values({
          id: f.id,
          storage_bucket: f.storageBucket,
          storage_key: f.storageKey,
          file_size: f.fileSize,
          mime_type: f.mimeType,
          checksum: f.checksum,
          original_name: f.originalName ?? null,
          created_by: f.createdBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },
  }
}

export type FileRepo = ReturnType<typeof createFileRepo>
