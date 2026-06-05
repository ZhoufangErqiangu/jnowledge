import { sql } from 'kysely'
import type { Config } from '../../../config/index.js'
import type { DB } from '../../../db/index.js'
import type { Models } from '../../../models/index.js'
import type { Infra } from '../../infra/index.js'
import type { Logger } from '../../../logger.js'
import type { ChunkRow } from '../../../models/chunk.repo.js'

export interface EmbeddingDeps {
  config: Config
  db: DB
  models: Models
  infra: Infra
  logger: Logger
}

export interface EmbeddingService {
  /** 为一个文档版本的全部 chunk 生成向量并写入（Contextual Retrieval 可选）。返回写入条数。 */
  embedVersion(versionId: string): Promise<number>
  /** 存量重建：给缺当前 model 向量的「当前版本」补 embedding（不重跑解析/分块）。 */
  backfillMissing(opts?: { limit?: number }): Promise<{ versions: number; chunks: number }>
}

const EMBED_BATCH = 32
const CONTEXT_CONCURRENCY = 5

export function createEmbeddingService(deps: EmbeddingDeps): EmbeddingService {
  const { config, db, models, infra, logger } = deps
  const { llm, vectorStore } = infra
  const model = llm.embedding.model

  /** Contextual Retrieval：用 light 模型为 chunk 生成在整篇文档中的定位上下文。 */
  async function buildContext(docContext: string, chunk: ChunkRow): Promise<string> {
    // 文档正文作为稳定前缀放最前——DeepSeek 自动上下文缓存对同文档的后续 chunk 命中，控成本。
    const prompt = [
      `<document>\n${docContext}\n</document>`,
      '',
      '这是该文档中的一个片段：',
      `<chunk>\n${chunk.content}\n</chunk>`,
      '',
      '请用一两句中文给出该片段在整篇文档中的定位上下文（用于改善检索召回）。只输出该上下文，不要任何解释或前后缀。',
    ].join('\n')
    try {
      const ctx = await llm.chat.tier('light').text({ prompt, temperature: 0 })
      return ctx.trim()
    } catch (err) {
      logger.warn({ chunkId: chunk.id, err }, 'contextual 上下文生成失败，回退为无上下文')
      return ''
    }
  }

  /** 把 chunk 列表转成待 embed 文本（含可选 contextual 前缀）。 */
  async function toEmbedTexts(versionContent: string, chunks: ChunkRow[]): Promise<string[]> {
    const useContextual = config.rag.contextual && llm.chat.configured
    if (!useContextual) return chunks.map((c) => c.content)

    const docContext = versionContent.slice(0, config.rag.contextMaxChars)
    const out = new Array<string>(chunks.length)
    // 有限并发生成上下文。
    let cursor = 0
    async function worker() {
      for (;;) {
        const i = cursor++
        if (i >= chunks.length) return
        const ctx = await buildContext(docContext, chunks[i]!)
        out[i] = ctx ? `${ctx}\n\n${chunks[i]!.content}` : chunks[i]!.content
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONTEXT_CONCURRENCY, chunks.length) }, () => worker()),
    )
    return out
  }

  async function embedVersion(versionId: string): Promise<number> {
    if (!llm.embedding.configured) {
      logger.warn({ versionId }, 'embedding 供应商未配置，跳过向量化（检索将无召回）')
      return 0
    }
    const chunks = await models.chunks.allByVersion(versionId)
    if (chunks.length === 0) return 0
    const version = await models.documentVersions.findById(versionId)
    const versionContent = version?.content ?? ''

    const texts = await toEmbedTexts(versionContent, chunks)

    // 分批向量化，逐批落库（失败可在批粒度重试，不重头）。
    let written = 0
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const slice = texts.slice(i, i + EMBED_BATCH)
      const vectors = await llm.embedding.embed(slice)
      const items = vectors.map((embedding, j) => ({
        chunkId: chunks[i + j]!.id,
        embedding,
      }))
      await vectorStore.upsertMany(model, items)
      written += items.length
    }
    logger.info({ versionId, written, contextual: config.rag.contextual }, 'embedVersion 完成')
    return written
  }

  async function backfillMissing(opts?: { limit?: number }) {
    const limit = opts?.limit ?? 50
    // 找「当前版本」中存在缺当前 model 向量 chunk 的 version。
    const res = await sql<{ version_id: string }>`
      SELECT DISTINCT dv.id AS version_id
      FROM documents d
      JOIN document_versions dv ON dv.id = d.current_version_id
      JOIN chunks c ON c.document_version_id = dv.id
      LEFT JOIN chunk_embeddings ce ON ce.chunk_id = c.id AND ce.model = ${model}
      WHERE d.deleted_at IS NULL AND ce.chunk_id IS NULL
      LIMIT ${limit}
    `.execute(db)

    let chunks = 0
    for (const row of res.rows) {
      chunks += await embedVersion(row.version_id)
    }
    return { versions: res.rows.length, chunks }
  }

  return { embedVersion, backfillMissing }
}
