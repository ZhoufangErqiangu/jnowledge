import type { Config } from '../../config/index.js'
import type { Models } from '../../models/index.js'
import type { EnrichedChunkRow } from '../../models/chunk.repo.js'
import type { Infra } from '../infra/index.js'
import type { Logger } from '../../logger.js'

/** 检索命中：一条 chunk + 定位信息 + 小到大组装后的上下文。 */
export interface RetrievedChunk {
  /** 1-based 引用序号，贯穿生成提示与最终 citation。 */
  marker: number
  chunkId: string
  documentId: string
  documentTitle: string
  versionId: string
  seq: number
  headingPath: string[]
  charStart: number
  charEnd: number
  /** 原 chunk 正文（用作 citation 摘要）。 */
  snippet: string
  /** 小到大扩展后的上下文（喂给生成模型）。 */
  context: string
  score: number
}

/** 跨库检索命中：RetrievedChunk 额外带来源库 id（小到大组装后回填）。 */
export interface GlobalHit extends RetrievedChunk {
  collectionId: string
}

export interface RetrievalDeps {
  config: Config
  models: Models
  infra: Infra
  logger: Logger
}

export interface RetrievalService {
  /** 完整混合检索：向量∥全文 → RRF → rerank → 小到大组装。返回 topK 命中。 */
  retrieve(collectionId: string, query: string): Promise<RetrievedChunk[]>
  /**
   * 跨库检索：对每个库分别召回 → 库内 RRF → 轮转交错汇成候选池 → 单次 rerank 给出跨库次序
   * → 小到大组装。纯检索，无 LLM 推理（不改写、不过滤、不生成）。命中带来源库 id。
   */
  searchGlobal(collectionIds: string[], query: string): Promise<GlobalHit[]>
}

/** rerank 候选上限（控成本/延迟）。 */
const RERANK_CANDIDATES = 40
/** 跨库检索时每个库进入候选池的上限（防单库刷屏，留出跨库空间）。 */
const GLOBAL_PER_COLLECTION = 20
/** 小到大组装：在 chunk char 区间两侧各扩展的字符数。 */
const ASSEMBLY_MARGIN = 600

export function createRetrievalService(deps: RetrievalDeps): RetrievalService {
  const { config, models, infra, logger } = deps
  const { llm, vectorStore } = infra
  const { vectorTopK, ftsTopK, rerankTopK, rrfK } = config.rag

  async function retrieve(collectionId: string, query: string): Promise<RetrievedChunk[]> {
    // 1) 混合召回（并行）：向量 + 中文全文。
    const [vectorHits, ftsHits] = await Promise.all([
      embedAndSearch(collectionId, query),
      models.chunks.ftsSearch(collectionId, query, ftsTopK),
    ])

    // 2) RRF 融合（倒数排名，免调参）。
    const fused = rrfFuse([vectorHits.map((h) => h.chunkId), ftsHits.map((h) => h.chunk_id)], rrfK)
    if (fused.length === 0) return []
    const candidateIds = fused.slice(0, RERANK_CANDIDATES).map((f) => f.chunkId)

    // 3) 取候选 chunk 正文与定位信息。
    const enriched = await models.chunks.getEnrichedByIds(candidateIds)
    const byId = new Map(enriched.map((e) => [e.id, e]))
    // 保持 RRF 次序（getEnrichedByIds 不保证顺序）。
    const ordered = candidateIds.map((id) => byId.get(id)).filter((e) => e !== undefined)

    // 4) rerank 精排（未配置则用 RRF 次序兜底）。
    let topChunks = ordered.slice(0, rerankTopK)
    if (llm.rerank.configured && ordered.length > 0) {
      try {
        const hits = await llm.rerank.rerank(
          query,
          ordered.map((e) => e.content),
          rerankTopK,
        )
        topChunks = hits.map((h) => ordered[h.index]!).filter(Boolean)
      } catch (err) {
        logger.warn({ err }, 'rerank 失败，回退 RRF 次序')
      }
    }

    // 5) small-to-big 组装：按 char 区间回版本全文扩展上下文。
    const result = await assemble(topChunks)
    logger.info(
      { collectionId, vector: vectorHits.length, fts: ftsHits.length, returned: result.length },
      'retrieve 完成',
    )
    return result
  }

  /** small-to-big 组装：按 char 区间回版本全文扩展上下文，依次分配 1-based marker。 */
  async function assemble(topChunks: EnrichedChunkRow[]): Promise<RetrievedChunk[]> {
    const versionContent = new Map<string, string>()
    const result: RetrievedChunk[] = []
    let marker = 1
    for (const e of topChunks) {
      let content = versionContent.get(e.document_version_id)
      if (content === undefined) {
        const v = await models.documentVersions.findById(e.document_version_id)
        content = v?.content ?? e.content
        versionContent.set(e.document_version_id, content)
      }
      const start = Math.max(0, e.char_start - ASSEMBLY_MARGIN)
      const end = Math.min(content.length, e.char_end + ASSEMBLY_MARGIN)
      result.push({
        marker: marker++,
        chunkId: e.id,
        documentId: e.document_id,
        documentTitle: e.document_title,
        versionId: e.document_version_id,
        seq: e.seq,
        headingPath: e.heading_path,
        charStart: e.char_start,
        charEnd: e.char_end,
        snippet: truncate(e.content, 200),
        context: content.slice(start, end),
        score: 0,
      })
    }
    return result
  }

  async function searchGlobal(collectionIds: string[], query: string): Promise<GlobalHit[]> {
    if (collectionIds.length === 0) return []
    // 1) 每库并行混合召回 → 库内 RRF 融合，得各库 chunkId 次序。
    const perCol = await Promise.all(
      collectionIds.map(async (cid) => {
        const [vec, fts] = await Promise.all([
          embedAndSearch(cid, query),
          models.chunks.ftsSearch(cid, query, ftsTopK),
        ])
        const fused = rrfFuse([vec.map((h) => h.chunkId), fts.map((h) => h.chunk_id)], rrfK)
        return { cid, ids: fused.slice(0, GLOBAL_PER_COLLECTION).map((f) => f.chunkId) }
      }),
    )
    // 2) 轮转交错汇成候选池（跨库公平；rerank 缺席时即最终次序）。
    const ranked = interleave(perCol.map((p) => p.ids))
    const candidateIds = ranked.slice(0, RERANK_CANDIDATES)
    if (candidateIds.length === 0) return []
    // chunk → 来源库归属（RetrievedChunk 不含 collectionId，组装后回填）。
    const colOf = new Map<string, string>()
    for (const p of perCol) for (const id of p.ids) if (!colOf.has(id)) colOf.set(id, p.cid)

    // 3) 取候选 chunk 正文与定位信息（保持交错次序）。
    const enriched = await models.chunks.getEnrichedByIds(candidateIds)
    const byId = new Map(enriched.map((e) => [e.id, e]))
    const ordered = candidateIds.map((id) => byId.get(id)).filter((e) => e !== undefined)

    // 4) 跨库精排：rerank 是唯一跨库可比的相关性信号（未配置则用交错次序兜底）。
    let topChunks = ordered.slice(0, rerankTopK)
    if (llm.rerank.configured && ordered.length > 0) {
      try {
        const hits = await llm.rerank.rerank(
          query,
          ordered.map((e) => e.content),
          rerankTopK,
        )
        topChunks = hits.map((h) => ordered[h.index]!).filter(Boolean)
      } catch (err) {
        logger.warn({ err }, 'rerank 失败，回退交错次序')
      }
    }

    // 5) small-to-big 组装 + 回填来源库 id。
    const assembled = await assemble(topChunks)
    logger.info(
      { collections: collectionIds.length, candidates: candidateIds.length, returned: assembled.length },
      'searchGlobal 完成',
    )
    return assembled.map((c) => ({ ...c, collectionId: colOf.get(c.chunkId) ?? '' }))
  }

  /** 向量召回：query 向量化 + HNSW 近邻（embedding 未配置则空）。 */
  async function embedAndSearch(collectionId: string, query: string) {
    if (!llm.embedding.configured) return []
    try {
      const [vec] = await llm.embedding.embed(query)
      if (!vec) return []
      return await vectorStore.query(collectionId, llm.embedding.model, vec, vectorTopK)
    } catch (err) {
      logger.warn({ err }, '向量召回失败，仅用全文召回')
      return []
    }
  }

  return { retrieve, searchGlobal }
}

/** 轮转交错合并多个有序列表（按位次逐轮取，跨列表公平），保序去重。 */
function interleave(lists: string[][]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const max = lists.reduce((m, l) => Math.max(m, l.length), 0)
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      const id = l[i]
      if (id !== undefined && !seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

/** Reciprocal Rank Fusion：多路排名列表 → 融合分降序。 */
function rrfFuse(lists: string[][], k: number): { chunkId: string; score: number }[] {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1))
    })
  }
  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score)
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`
}
