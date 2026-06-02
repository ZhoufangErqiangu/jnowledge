import { z } from 'zod'
import { isoDateSchema, uuidSchema } from './common.js'

/** 对象存储中的物理文件元数据（库里只存 key，不存内容）。 */
export const fileMetaSchema = z.object({
  id: uuidSchema,
  /** 服务端按魔数检测出的真实 MIME（与客户端声称分开存） */
  mimeType: z.string(),
  fileSize: z.number().int().nonnegative(),
  /** sha256，做去重 */
  checksum: z.string(),
  originalName: z.string().nullable(),
  createdAt: isoDateSchema,
})
export type FileMeta = z.infer<typeof fileMetaSchema>
