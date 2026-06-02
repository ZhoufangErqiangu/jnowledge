import { z } from 'zod'
import type { Citation } from '@jnowledge/shared'
import type { RetrievalService, RetrievedChunk } from '../../../domain/retrieval.js'
import type { Tool, ToolResult } from '../types.js'

const paramsSchema = z.object({
  query: z.string().min(1).describe('要在知识库中检索的查询（自然语言，尽量具体完整）'),
})

/**
 * composite 工具：把整条混合检索流水线（改写省略，向量∥全文→RRF→rerank→小到大）封成一个工具。
 * primitive（vector/fts/rerank）仍封在 retrieval 里不外露——压住 agent 的工具搜索域。
 * 命中以全局 marker 追加进 ctx.citations，输出文本带 [序号] 供模型在答复中引用。
 */
export function createKnowledgeSearchTool(retrieval: RetrievalService): Tool {
  return {
    name: 'knowledge_search',
    description:
      '在当前知识库中检索与查询最相关的资料片段。当回答需要依据知识库内容时调用；可多次调用以细化或补充检索。返回的每条资料以 [序号] 开头，回答时引用了某条资料须在句末标注对应 [序号]。',
    paramsSchema,
    handler: async (args, ctx): Promise<ToolResult> => {
      const { query } = args as z.infer<typeof paramsSchema>
      const chunks = await retrieval.retrieve(ctx.collectionId, query)
      if (chunks.length === 0) {
        return {
          ok: true,
          output: '（未检索到相关资料）',
          summary: `knowledge_search("${query}")：无命中`,
        }
      }
      // 全局唯一 marker：跨多次检索不冲突。
      const base = ctx.citations.length
      const cited: Citation[] = chunks.map((c, i) => toCitation(c, base + i + 1))
      ctx.citations.push(...cited)
      const output = cited
        .map((c, i) => {
          const where = c.headingPath.length ? `（${c.headingPath.join(' > ')}）` : ''
          return `[${c.marker}] 《${c.documentTitle}》${where}\n${chunks[i]!.context}`
        })
        .join('\n\n')
      return {
        ok: true,
        output,
        summary: `knowledge_search("${query}")：命中 ${chunks.length} 条`,
        citations: cited,
      }
    },
  }
}

function toCitation(c: RetrievedChunk, marker: number): Citation {
  return {
    marker,
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    versionId: c.versionId,
    seq: c.seq,
    headingPath: c.headingPath,
    charStart: c.charStart,
    charEnd: c.charEnd,
    snippet: c.snippet,
  }
}
