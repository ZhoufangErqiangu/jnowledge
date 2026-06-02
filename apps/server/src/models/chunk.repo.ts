import type { Selectable } from 'kysely'
import type { DB } from '../db/index.js'
import type { ChunksTable } from '../db/types.js'

export type ChunkRow = Selectable<ChunksTable>

export interface NewChunk {
  id: string
  documentVersionId: string
  seq: number
  content: string
  tokenCount: number
  charStart: number
  charEnd: number
  headingPath: string[]
}

export function createChunkRepo(db: DB) {
  return {
    async listByVersion(
      versionId: string,
      limit: number,
      offset: number,
    ): Promise<{ items: ChunkRow[]; total: number }> {
      const items = await db
        .selectFrom('chunks')
        .selectAll()
        .where('document_version_id', '=', versionId)
        .orderBy('seq', 'asc')
        .limit(limit)
        .offset(offset)
        .execute()

      const { count } = await db
        .selectFrom('chunks')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('document_version_id', '=', versionId)
        .executeTakeFirstOrThrow()

      return { items, total: Number(count) }
    },

    async countByVersion(versionId: string): Promise<number> {
      const { count } = await db
        .selectFrom('chunks')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('document_version_id', '=', versionId)
        .executeTakeFirstOrThrow()
      return Number(count)
    },

    /** 批量插入一个版本的全部 chunk。 */
    async insertMany(chunks: NewChunk[]): Promise<void> {
      if (chunks.length === 0) return
      await db
        .insertInto('chunks')
        .values(
          chunks.map((c) => ({
            id: c.id,
            document_version_id: c.documentVersionId,
            seq: c.seq,
            content: c.content,
            token_count: c.tokenCount,
            char_start: c.charStart,
            char_end: c.charEnd,
            heading_path: c.headingPath,
          })),
        )
        .execute()
    },

    async deleteByVersion(versionId: string): Promise<void> {
      await db.deleteFrom('chunks').where('document_version_id', '=', versionId).execute()
    },
  }
}

export type ChunkRepo = ReturnType<typeof createChunkRepo>
