import { z } from 'zod'
import { uuidSchema } from './common.js'

/** 全局检索请求：一句查询，跨 principal 可访问的全部知识库。 */
export const searchRequestSchema = z.object({
  query: z.string().min(1).max(1000),
})
export type SearchRequest = z.infer<typeof searchRequestSchema>

/**
 * 检索命中（文档级聚合）：按相关性排序的一篇文档 + 其最佳命中片段。
 * 纯检索结果——不经任何 LLM 推理（无改写、无相关性过滤、无生成）。
 */
export const searchHitSchema = z.object({
  documentId: uuidSchema,
  documentTitle: z.string(),
  collectionId: uuidSchema,
  collectionName: z.string(),
  /** 该文档下最相关 chunk 的摘要片段（展示用）。 */
  snippet: z.string(),
  /** 最佳命中所在的标题路径。 */
  headingPath: z.array(z.string()),
  /** 该文档贡献的命中 chunk 数（同一文档多段命中时聚合计数）。 */
  hitCount: z.number().int().positive(),
})
export type SearchHit = z.infer<typeof searchHitSchema>

/** 检索响应：回显查询 + 按相关性降序的文档命中列表。 */
export const searchResponseSchema = z.object({
  query: z.string(),
  hits: z.array(searchHitSchema),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>
