import { z } from 'zod'
import { uuidv7 } from 'uuidv7'
import type { Citation } from '@jnowledge/shared'
import type { ContextItemRepo } from '../../../../models/contextItem.repo.js'
import type { CollectionService } from '../../../domain/collection.service.js'
import type { RetrievalService, RetrievedChunk } from '../../../domain/retrieval.js'
import type { FilterResult, RelevanceFilter } from '../relevanceFilter.js'
import type { RunContext, Tool, ToolResult } from '../types.js'
import { inCeiling, outOfScope } from '../scope.js'

const paramsSchema = z.object({
  query: z.string().min(1).describe('要在知识库中检索的查询（自然语言，尽量具体完整）'),
  collectionId: z
    .string()
    .describe('要检索的知识库 id（必填，取自 list_collections）'),
})

/**
 * composite 工具：把整条混合检索流水线（改写省略，向量∥全文→RRF→rerank→小到大）封成一个工具。
 * primitive（vector/fts/rerank）仍封在 retrieval 里不外露——压住 agent 的工具搜索域。
 * 命中以全局 marker 追加进 ctx.citations，输出文本带 [序号] 供模型在答复中引用。
 *
 * 作用域：模型经 collectionId 参数显式选库。先校验该库在本 run 的作用域天花板内
 * （inCeiling；越界 out_of_scope，须回报不得绕过），再按 ctx.principal 校验 viewer 权限。
 */
export function createKnowledgeSearchTool(
  retrieval: RetrievalService,
  collectionService: CollectionService,
  filter: RelevanceFilter,
  contextItems: ContextItemRepo,
): Tool {
  /**
   * 把过滤判决落成 internal 条目（stage=rag_filter）：留痕于 raw 视图与 run 树，但不进 LLM/用户视图。
   * 与安全审计同属"第三状态"子推理留痕（DESIGN §8.3 / PLAN §14.3）——堵住"过滤结果产生即丢"的洞。
   * 仅在过滤实际执行（applied）时落；命中过少/未配置（applied=false）无 LLM 调用，不留痕。
   */
  async function recordFilterTrace(
    ctx: RunContext,
    query: string,
    result: FilterResult,
  ): Promise<void> {
    try {
      await contextItems.insert({
        id: uuidv7(),
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        kind: 'tool_result',
        content: `RAG 相关性过滤：保留 ${result.kept.length} / 丢弃 ${result.dropped.length}（查询：${query}）`,
        flags: { state: 'internal' },
        meta: {
          stage: 'rag_filter',
          name: 'knowledge_search',
          input: { query },
          verdict: { kept: result.kept.length, dropped: result.dropped },
          summary: `保留 ${result.kept.length} / 丢弃 ${result.dropped.length}`,
          ...(result.llm ? { llm: result.llm } : {}),
        },
      })
    } catch {
      // 落库失败不应阻断检索主流程（留痕是旁路）。
    }
  }

  return {
    name: 'knowledge_search',
    description:
      '检索与查询最相关的资料片段。须先用 list_collections 选定一个库并在 collectionId 参数中指定。可多次调用以细化或补充检索。返回的每条资料以 [序号] 开头，回答时引用了某条资料须在句末标注对应 [序号]。',
    paramsSchema,
    handler: async (args, ctx): Promise<ToolResult> => {
      const { query, collectionId: target } = args as z.infer<typeof paramsSchema>
      // 作用域天花板：越界直接拒（数组天花板时生效；principal 恒过）。
      if (!inCeiling(ctx.scope, target)) return outOfScope(target, ctx.scope)
      // 实权边界：按 principal 校验该库访问权限（防越权检索）。
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
      const hits = await retrieval.retrieve(target, query)
      // 抽取式相关性过滤（§14.4）：agent 见到的也是过滤后结果；marker 在过滤后再分配。
      const result = await filter.filter(query, hits)
      const { kept: chunks } = result
      // 过滤子推理留痕（含耗时/用量）：仅在过滤实际执行时落 internal 条目。
      if (result.applied) await recordFilterTrace(ctx, query, result)
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
