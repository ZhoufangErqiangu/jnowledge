import { z } from 'zod'
import { COLLECTION_ROLES } from '../constants/enums.js'
import { isoDateSchema, uuidSchema } from './common.js'
import { publicUserSchema } from './auth.js'

/** 知识库可配置项（默认 embedding 模型 / chunking 覆盖等，二期起填充）。 */
export const collectionSettingsSchema = z
  .object({
    embeddingModel: z.string().optional(),
    chunking: z
      .object({
        targetTokens: z.number().int().positive().optional(),
        overlapRatio: z.number().min(0).max(0.5).optional(),
      })
      .optional(),
  })
  .default({})
export type CollectionSettings = z.infer<typeof collectionSettingsSchema>

export const createCollectionRequestSchema = z.object({
  name: z.string().min(1).max(128),
  /** 自嵌套做文件夹；顶层为 null。 */
  parentId: uuidSchema.nullable().optional(),
  description: z.string().max(1024).optional(),
  settings: collectionSettingsSchema.optional(),
})
export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>

export const updateCollectionRequestSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  parentId: uuidSchema.nullable().optional(),
  description: z.string().max(1024).nullable().optional(),
  settings: collectionSettingsSchema.optional(),
})
export type UpdateCollectionRequest = z.infer<typeof updateCollectionRequestSchema>

export const collectionSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  parentId: uuidSchema.nullable(),
  ownerId: uuidSchema,
  description: z.string().nullable(),
  settings: collectionSettingsSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})
export type Collection = z.infer<typeof collectionSchema>

/** 文件夹树节点（collection.controller 树形接口返回）。 */
export interface CollectionTreeNode extends Collection {
  children: CollectionTreeNode[]
}
export const collectionTreeNodeSchema: z.ZodType<CollectionTreeNode> = collectionSchema.extend({
  children: z.lazy(() => z.array(collectionTreeNodeSchema)),
})

// ---- 成员管理 ----

export const addMemberRequestSchema = z.object({
  userId: uuidSchema,
  role: z.enum(COLLECTION_ROLES),
})
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>

export const updateMemberRequestSchema = z.object({
  role: z.enum(COLLECTION_ROLES),
})
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>

export const collectionMemberSchema = z.object({
  collectionId: uuidSchema,
  role: z.enum(COLLECTION_ROLES),
  user: publicUserSchema,
  createdAt: isoDateSchema,
})
export type CollectionMember = z.infer<typeof collectionMemberSchema>
