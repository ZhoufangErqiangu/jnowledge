import type { SearchHit } from '@jnowledge/shared'
import type { Logger } from '../../logger.js'
import type { CollectionService, Principal } from './collection.service.js'
import type { RetrievalService } from './retrieval.js'

export interface SearchDeps {
  logger: Logger
  collectionService: CollectionService
  retrieval: RetrievalService
}

export interface SearchService {
  /**
   * 全局检索：跨 principal 可访问的全部知识库，按相关性返回文档级命中。
   * 纯检索——不做任何 LLM 推理（无改写、无相关性过滤、无生成）。
   */
  search(p: Principal, query: string): Promise<SearchHit[]>
}

export function createSearchService(deps: SearchDeps): SearchService {
  const { collectionService, retrieval } = deps

  return {
    async search(p, query) {
      // 作用域 = principal 可访问的全部库（实权边界）。
      const cols = await collectionService.listAccessible(p)
      if (cols.length === 0) return []
      const colName = new Map(cols.map((c) => [c.id, c.name]))

      const chunks = await retrieval.searchGlobal(
        cols.map((c) => c.id),
        query,
      )

      // 文档级聚合：保序去重（首见即该文档最相关命中），同文档多段命中累加 hitCount。
      const byDoc = new Map<string, SearchHit>()
      for (const c of chunks) {
        const existing = byDoc.get(c.documentId)
        if (existing) {
          existing.hitCount++
          continue
        }
        byDoc.set(c.documentId, {
          documentId: c.documentId,
          documentTitle: c.documentTitle,
          collectionId: c.collectionId,
          collectionName: colName.get(c.collectionId) ?? '',
          snippet: c.snippet,
          headingPath: c.headingPath,
          hitCount: 1,
        })
      }
      return [...byDoc.values()]
    },
  }
}
