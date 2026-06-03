import { z } from 'zod'
import type { Citation } from '@jnowledge/shared'
import type { CollectionService } from '../../../domain/collection.service.js'
import type { RetrievalService, RetrievedChunk } from '../../../domain/retrieval.js'
import type { Tool, ToolResult } from '../types.js'

const paramsSchema = z.object({
  query: z.string().min(1).describe('要在知识库中检索的查询（自然语言，尽量具体完整）'),
  collectionId: z
    .string()
    .optional()
    .describe(
      '要检索的知识库 id：全局助手必填（取自 list_collections）；知识库内问答可省略，默认当前库',
    ),
})

/**
 * composite 工具：把整条混合检索流水线（改写省略，向量∥全文→RRF→rerank→小到大）封成一个工具。
 * primitive（vector/fts/rerank）仍封在 retrieval 里不外露——压住 agent 的工具搜索域。
 * 命中以全局 marker 追加进 ctx.citations，输出文本带 [序号] 供模型在答复中引用。
 *
 * 作用域：知识库会话固定 ctx.collectionId；全局会话由模型经 collectionId 参数选库，
 * 此时按 ctx.principal 校验该库的 viewer 权限（防越权检索）。
 */
export function createKnowledgeSearchTool(
  retrieval: RetrievalService,
  collectionService: CollectionService,
): Tool {
  return {
    name: 'knowledge_search',
    description:
      '检索与查询最相关的资料片段。知识库内问答默认检索当前库；全局助手须先用 list_collections 选定一个库并在 collectionId 参数中指定。可多次调用以细化或补充检索。返回的每条资料以 [序号] 开头，回答时引用了某条资料须在句末标注对应 [序号]。',
    paramsSchema,
    handler: async (args, ctx): Promise<ToolResult> => {
      const { query, collectionId } = args as z.infer<typeof paramsSchema>
      const target = collectionId ?? ctx.collectionId
      if (!target) {
        return {
          ok: false,
          output:
            '未指定知识库。请先调用 list_collections，再在 collectionId 参数中传入选定的库 id。',
          summary: 'knowledge_search：缺少 collectionId',
          error: 'collectionId required',
        }
      }
      // 模型自选的库（与绑定库不同）需校验访问权限。
      if (target !== ctx.collectionId) {
        try {
          await collectionService.assertRole(ctx.principal, target, 'viewer')
        } catch {
          return {
            ok: false,
            output: '无权访问该知识库，或该知识库不存在。',
            summary: `knowledge_search：无权访问 ${target}`,
            error: 'forbidden',
          }
        }
      }
      const chunks = await retrieval.retrieve(target, query)
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
