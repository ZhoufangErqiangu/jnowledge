import { z } from 'zod'
import {
  CONTENT_FORMATS,
  DOCUMENT_SOURCE_TYPES,
  DOCUMENT_STATUSES,
} from '../constants/enums.js'
import { isoDateSchema, uuidSchema } from './common.js'

/** 手动创建文档（正文直接是 Markdown，不经上传/解析）。 */
export const createDocumentRequestSchema = z.object({
  collectionId: uuidSchema,
  title: z.string().min(1).max(512),
  content: z.string().default(''),
})
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>

/** 编辑文档：任一字段变更都会生成新版本（checksum 未变则跳过）。 */
export const updateDocumentRequestSchema = z
  .object({
    title: z.string().min(1).max(512).optional(),
    content: z.string().optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: '至少提供 title 或 content',
  })
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>

export const documentSchema = z.object({
  id: uuidSchema,
  collectionId: uuidSchema,
  title: z.string(),
  sourceType: z.enum(DOCUMENT_SOURCE_TYPES),
  currentVersionId: uuidSchema.nullable(),
  status: z.enum(DOCUMENT_STATUSES),
  statusError: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})
export type Document = z.infer<typeof documentSchema>

export const documentVersionSchema = z.object({
  id: uuidSchema,
  documentId: uuidSchema,
  versionNo: z.number().int().positive(),
  content: z.string(),
  contentFormat: z.enum(CONTENT_FORMATS),
  checksum: z.string(),
  /** 上传来源文件；手动编辑为 null。 */
  sourceFileId: uuidSchema.nullable(),
  authorId: uuidSchema,
  createdAt: isoDateSchema,
})
export type DocumentVersion = z.infer<typeof documentVersionSchema>

/** 版本历史列表项（不含 content 全文，省带宽）。 */
export const documentVersionSummarySchema = documentVersionSchema.omit({ content: true })
export type DocumentVersionSummary = z.infer<typeof documentVersionSummarySchema>

export const chunkSchema = z.object({
  id: uuidSchema,
  documentVersionId: uuidSchema,
  seq: z.number().int().nonnegative(),
  content: z.string(),
  tokenCount: z.number().int().nonnegative(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  headingPath: z.array(z.string()),
})
export type Chunk = z.infer<typeof chunkSchema>

/** 文档详情：文档 + 当前版本 + chunk 数（不内联全部 chunk）。 */
export const documentDetailSchema = z.object({
  document: documentSchema,
  currentVersion: documentVersionSchema.nullable(),
  chunkCount: z.number().int().nonnegative(),
})
export type DocumentDetail = z.infer<typeof documentDetailSchema>
