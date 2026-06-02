/**
 * 向量检索隔离接口。一期仅定义契约 + 占位实现（不落地检索）。
 * 二期实现 PgVectorStore（pgvector + HNSW）；规模到千万再局部迁 Qdrant，
 * 届时只换实现不动调用方。
 */
export interface VectorMatch {
  chunkId: string
  score: number
}

export interface VectorStore {
  /** 写入/更新某 chunk 的向量。 */
  upsert(chunkId: string, model: string, embedding: number[]): Promise<void>
  /** 近邻检索。 */
  query(model: string, embedding: number[], topK: number): Promise<VectorMatch[]>
  /** 删除某 chunk 的全部向量。 */
  delete(chunkId: string): Promise<void>
}

/** 一期占位：调用即报错，提醒尚未到二期。 */
export function createNullVectorStore(): VectorStore {
  const notReady = (): never => {
    throw new Error('VectorStore 未实现（二期接入 pgvector）')
  }
  return {
    async upsert() {
      notReady()
    },
    async query() {
      return notReady()
    },
    async delete() {
      notReady()
    },
  }
}
