import { z } from 'zod'

/** UUIDv7 主键。运行期只校验 UUID 形态，版本由后端生成保证。 */
export const uuidSchema = z.uuid()

/** ISO8601 时间串（响应里 timestamptz 序列化形态）。 */
export const isoDateSchema = z.iso.datetime({ offset: true })

/** 分页查询参数（query string，故用 coerce 把字符串转数字）。 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

/** 分页响应包装器工厂。 */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  })
}

/** 统一错误响应体（中间件输出形态）。 */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** zod 校验失败时的字段级明细 */
    details: z.unknown().optional(),
  }),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>
