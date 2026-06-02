/**
 * 全平台枚举的唯一定义处。
 * zod schema、DB 迁移、前端选项都引用这里，避免散落的魔法字符串。
 */

/** 用户角色（系统级） */
export const USER_ROLES = ['admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]

/** 用户状态 */
export const USER_STATUSES = ['active', 'disabled'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/** 知识库成员角色（collection 级 ACL） */
export const COLLECTION_ROLES = ['owner', 'editor', 'viewer'] as const
export type CollectionRole = (typeof COLLECTION_ROLES)[number]

/** collection 成员角色权限等级（数值越大权限越高，用于 requireCollectionRole 比较） */
export const COLLECTION_ROLE_RANK: Record<CollectionRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
}

/** 文档来源类型 */
export const DOCUMENT_SOURCE_TYPES = ['upload', 'manual'] as const
export type DocumentSourceType = (typeof DOCUMENT_SOURCE_TYPES)[number]

/**
 * 文档处理状态机。
 * 上传后异步走：pending → parsing → chunking → embedding → ready
 * 任一步失败 → failed（status_error 记原因）。
 * 一期 embedding 步骤留桩直接跳到 ready；二期接入真正 embedding。
 */
export const DOCUMENT_STATUSES = [
  'pending',
  'parsing',
  'chunking',
  'embedding',
  'ready',
  'failed',
] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

/** 内容格式：归一化后正文统一为 markdown（一期唯一合法值） */
export const CONTENT_FORMATS = ['markdown'] as const
export type ContentFormat = (typeof CONTENT_FORMATS)[number]

/**
 * LLM 成本层级（Tier Router）。
 * 业务只声明 tier，tier→具体模型的绑定集中在后端配置。
 * 一期仅定义枚举与接口；真正路由二期接入。
 */
export const LLM_TIERS = ['heavy', 'standard', 'light', 'nano'] as const
export type LlmTier = (typeof LLM_TIERS)[number]
