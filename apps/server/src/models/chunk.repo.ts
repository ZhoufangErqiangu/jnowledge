import { sql, type Selectable } from 'kysely'
import type { ChunksTable, DB } from './schema.js'

export type ChunkRow = Selectable<ChunksTable>

/** chunk + 所属文档定位信息（检索引用/小到大组装用）。 */
export interface EnrichedChunkRow extends ChunkRow {
  document_id: string
  document_title: string
}

/** 召回打分行（向量/全文/融合共用）。 */
export interface ScoredChunk {
  chunk_id: string
  score: number
}

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

    /** 一个版本的全部 chunk（按 seq，无分页）——embedding 与小到大组装用。 */
    async allByVersion(versionId: string): Promise<ChunkRow[]> {
      return db
        .selectFrom('chunks')
        .selectAll()
        .where('document_version_id', '=', versionId)
        .orderBy('seq', 'asc')
        .execute()
    },

    /** 按 id 批量取 chunk + 文档定位信息（检索结果落地引用用）。 */
    async getEnrichedByIds(ids: string[]): Promise<EnrichedChunkRow[]> {
      if (ids.length === 0) return []
      return db
        .selectFrom('chunks as c')
        .innerJoin('document_versions as dv', 'dv.id', 'c.document_version_id')
        .innerJoin('documents as d', 'd.id', 'dv.document_id')
        .selectAll('c')
        .select(['d.id as document_id', 'd.title as document_title'])
        .where('c.id', 'in', ids)
        .execute() as Promise<EnrichedChunkRow[]>
    },

    /**
     * 中文全文召回：限定某知识库的当前版本 chunk，与向量召回并行后交 RRF 融合。
     * 用 OR 语义（把 plainto_tsquery 的 AND 改成 OR）提升召回——追问里的无关词不应一票否决；
     * 排序仍用 ts_rank，精度交给后续 rerank。
     */
    async ftsSearch(collectionId: string, query: string, topK: number): Promise<ScoredChunk[]> {
      const res = await sql<ScoredChunk>`
        WITH q AS (
          SELECT NULLIF(replace(plainto_tsquery('chinese_zh', ${query})::text, ' & ', ' | '), '')::tsquery AS tsq
        )
        SELECT c.id AS chunk_id, ts_rank(c.tsv, q.tsq) AS score
        FROM chunks c
        JOIN document_versions dv ON dv.id = c.document_version_id
        JOIN documents d ON d.id = dv.document_id
        CROSS JOIN q
        WHERE q.tsq IS NOT NULL
          AND d.collection_id = ${collectionId}
          AND d.deleted_at IS NULL
          AND d.current_version_id = dv.id
          AND c.tsv @@ q.tsq
        ORDER BY score DESC
        LIMIT ${topK}
      `.execute(db)
      return res.rows
    },
  }
}

export type ChunkRepo = ReturnType<typeof createChunkRepo>
