import type { ColumnType } from 'kysely'

/**
 * 跨表共用的列变体助手。
 * 这些是「数据库生成 / 默认」列的 Kysely 三态（Select / Insert / Update）声明，
 * 被多张表的 created_at/updated_at/deleted_at 复用。抽出独立成家，避免散落在表定义里。
 */

/** 生成/默认时间戳：插入可省略（DB 填 now()），selectable 为 Date，禁更新。 */
export type CreatedAt = ColumnType<Date, Date | string | undefined, never>
/** 可更新时间戳：插入可省略，允许更新（触发器或显式 set now()）。 */
export type UpdatedAt = ColumnType<Date, Date | string | undefined, Date | string>
/** 软删时间戳：可空，插入可省略，允许更新（删/恢复）。 */
export type DeletedAt = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
