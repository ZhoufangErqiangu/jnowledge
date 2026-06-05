import type { Config } from '../../config/index.js'
import type { Models } from '../../models/index.js'
import type { Infra } from '../infra/index.js'
import type { Logger } from '../../logger.js'
import type { ChatMessage } from '../infra/llm/types.js'

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

export interface RetrievalDeps {
  config: Config
  models: Models
  infra: Infra
  logger: Logger
}

export interface RetrievalService {
  /** 结合会话历史把追问改写成可独立检索的查询（指代消解/补全）。 */
  rewriteQuery(question: string, history: ChatMessage[]): Promise<string>
  /** 完整混合检索：向量∥全文 → RRF → rerank → 小到大组装。返回 topK 命中。 */
  retrieve(collectionId: string, query: string): Promise<RetrievedChunk[]>
}

/** rerank 候选上限（控成本/延迟）。 */
const RERANK_CANDIDATES = 40
/** 小到大组装：在 chunk char 区间两侧各扩展的字符数。 */
const ASSEMBLY_MARGIN = 600

export function createRetrievalService(deps: RetrievalDeps): RetrievalService {
  const { config, models, infra, logger } = deps
  const { llm, vectorStore } = infra
  const { vectorTopK, ftsTopK, rerankTopK, rrfK } = config.rag

  async function rewriteQuery(question: string, history: ChatMessage[]): Promise<string> {
    if (!llm.chat.configured || history.length === 0) return question
    const transcript = history
      .slice(-6)
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n')
    try {
      const rewritten = await llm.chat.tier('nano').text({
        system:
          '你是检索查询改写器。根据对话历史，把用户的最新追问改写成一个语义完整、可独立用于知识库检索的查询。消解指代（它/这个/那个等），补全省略的主语。只输出改写后的查询，不要解释。',
        prompt: `对话历史：\n${transcript}\n\n最新追问：${question}\n\n改写后的查询：`,
        temperature: 0,
      })
      const out = rewritten.trim()
      return out.length > 0 ? out : question
    } catch (err) {
      logger.warn({ err }, 'query 改写失败，使用原始查询')
      return question
    }
  }

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
    logger.info(
      { collectionId, vector: vectorHits.length, fts: ftsHits.length, returned: result.length },
      'retrieve 完成',
    )
    return result
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

  return { rewriteQuery, retrieve }
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
