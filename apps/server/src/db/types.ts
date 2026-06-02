import type { ColumnType, Generated, JSONColumnType } from 'kysely'
import type {
  CollectionRole,
  CollectionSettings,
  ContentFormat,
  DocumentSourceType,
  DocumentStatus,
  UserRole,
  UserStatus,
} from '@jnowledge/shared'

/** 数据库生成 / 默认的时间戳：可选插入，selectable 为 Date。 */
type CreatedAt = ColumnType<Date, Date | string | undefined, never>
type UpdatedAt = ColumnType<Date, Date | string | undefined, Date | string>
type DeletedAt = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>

export interface UsersTable {
  id: string // UUIDv7，应用层生成
  email: string
  password_hash: string
  display_name: ColumnType<string | null, string | null | undefined, string | null>
  role: ColumnType<UserRole, UserRole | undefined, UserRole>
  status: ColumnType<UserStatus, UserStatus | undefined, UserStatus>
  created_at: CreatedAt
  updated_at: UpdatedAt
  deleted_at: DeletedAt
}

export interface CollectionsTable {
  id: string
  name: string
  parent_id: ColumnType<string | null, string | null | undefined, string | null>
  owner_id: string
  description: ColumnType<string | null, string | null | undefined, string | null>
  settings: JSONColumnType<CollectionSettings, CollectionSettings | string | undefined, CollectionSettings | string>
  created_by: string
  created_at: CreatedAt
  updated_at: UpdatedAt
  deleted_at: DeletedAt
}

export interface CollectionMembersTable {
  collection_id: string
  user_id: string
  role: CollectionRole
  created_by: string
  created_at: CreatedAt
  updated_at: UpdatedAt
}

export interface FilesTable {
  id: string
  storage_bucket: string
  storage_key: string
  file_size: ColumnType<number, number | bigint, never>
  /** 服务端按魔数检测出的真实 MIME */
  mime_type: string
  /** sha256，去重 */
  checksum: string
  original_name: ColumnType<string | null, string | null | undefined, never>
  created_by: string
  created_at: CreatedAt
  deleted_at: DeletedAt
}

export interface DocumentsTable {
  id: string
  collection_id: string
  title: string
  source_type: DocumentSourceType
  current_version_id: ColumnType<string | null, string | null | undefined, string | null>
  status: ColumnType<DocumentStatus, DocumentStatus | undefined, DocumentStatus>
  status_error: ColumnType<string | null, string | null | undefined, string | null>
  created_by: string
  created_at: CreatedAt
  updated_at: UpdatedAt
  deleted_at: DeletedAt
}

export interface DocumentVersionsTable {
  id: string
  document_id: string
  version_no: number
  content: string
  content_format: ColumnType<ContentFormat, ContentFormat | undefined, never>
  checksum: string
  source_file_id: ColumnType<string | null, string | null | undefined, never>
  author_id: string
  created_at: CreatedAt
}

export interface ChunksTable {
  id: string
  document_version_id: string
  seq: number
  content: string
  token_count: number
  char_start: number
  char_end: number
  /** 章节路径，text[] */
  heading_path: ColumnType<string[], string[], string[]>
  created_at: CreatedAt
}

/** Kysely 数据库契约：表名 → 行类型。 */
export interface Database {
  users: UsersTable
  collections: CollectionsTable
  collection_members: CollectionMembersTable
  files: FilesTable
  documents: DocumentsTable
  document_versions: DocumentVersionsTable
  chunks: ChunksTable
}

export type { Generated }
