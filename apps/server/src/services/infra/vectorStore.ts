import { sql } from 'kysely'
import type { DB } from '../../models/schema.js'

/**
 * 向量检索隔离接口。二期落地 PgVectorStore（pgvector + HNSW cosine）。
 * 规模到千万再局部迁 Qdrant，届时只换实现不动调用方。
 */
export interface VectorMatch {
  chunkId: string
  /** 余弦相似度（1 - 距离），越大越相关。 */
  score: number
}

export interface EmbeddingInput {
  chunkId: string
  embedding: number[]
}

export interface VectorStore {
  /** 批量写入/更新某 model 下一组 chunk 的向量（on conflict 覆盖）。 */
  upsertMany(model: string, items: EmbeddingInput[]): Promise<void>
  /**
   * 近邻检索：限定某知识库的「当前版本」chunk（join 文档与当前版本）。
   * 返回按相似度降序的 chunkId + score。
   */
  query(
    collectionId: string,
    model: string,
    embedding: number[],
    topK: number,
  ): Promise<VectorMatch[]>
  /** 删除某 chunk 的全部向量（chunk 删除时 FK 级联已兜底，此处供显式调用）。 */
  deleteByChunk(chunkId: string): Promise<void>
}

/** pgvector 文本字面量：number[] → '[0.1,0.2,...]'。 */
function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

export function createPgVectorStore(db: DB): VectorStore {
  return {
    async upsertMany(model, items) {
      if (items.length === 0) return
      await db
        .insertInto('chunk_embeddings')
        .values(
          items.map((it) => ({
            chunk_id: it.chunkId,
            model,
            dim: it.embedding.length,
            embedding: toVectorLiteral(it.embedding),
          })),
        )
        .onConflict((oc) =>
          oc.columns(['chunk_id', 'model']).doUpdateSet((eb) => ({
            embedding: eb.ref('excluded.embedding'),
            dim: eb.ref('excluded.dim'),
          })),
        )
        .execute()
    },

    async query(collectionId, model, embedding, topK) {
      const lit = toVectorLiteral(embedding)
      // <=> 为 cosine 距离（配 vector_cosine_ops 索引）；score = 1 - 距离。
      const res = await sql<{ chunk_id: string; score: number }>`
        SELECT ce.chunk_id, 1 - (ce.embedding <=> ${lit}::vector) AS score
        FROM chunk_embeddings ce
        JOIN chunks c ON c.id = ce.chunk_id
        JOIN document_versions dv ON dv.id = c.document_version_id
        JOIN documents d ON d.id = dv.document_id
        WHERE ce.model = ${model}
          AND d.collection_id = ${collectionId}
          AND d.deleted_at IS NULL
          AND d.current_version_id = dv.id
        ORDER BY ce.embedding <=> ${lit}::vector
        LIMIT ${topK}
      `.execute(db)
      return res.rows.map((r) => ({ chunkId: r.chunk_id, score: Number(r.score) }))
    },

    async deleteByChunk(chunkId) {
      await db.deleteFrom('chunk_embeddings').where('chunk_id', '=', chunkId).execute()
    },
  }
}
