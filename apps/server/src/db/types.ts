import type { ColumnType, Generated, JSONColumnType } from 'kysely'
import type {
  AgentRunStatus,
  Citation,
  CollectionRole,
  CollectionSettings,
  ContentFormat,
  ContextItemFlags,
  ContextItemKind,
  ContextItemMeta,
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
  settings: JSONColumnType<
    CollectionSettings,
    CollectionSettings | string | undefined,
    CollectionSettings | string
  >
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
  /** 中文全文检索向量（生成列，to_tsvector('chinese_zh', content)）。只读，禁插入。 */
  tsv: ColumnType<string, never, never>
  created_at: CreatedAt
}

/** chunk 向量：每 chunk × model 一条。embedding 以 pgvector 文本字面量收发（'[..]'）。 */
export interface ChunkEmbeddingsTable {
  chunk_id: string
  model: string
  dim: number
  embedding: ColumnType<string, string, string>
  created_at: CreatedAt
}

export interface ConversationsTable {
  id: string
  /** null = 全局会话（仅 agent，不绑知识库）。 */
  collection_id: string | null
  title: string
  created_by: string
  created_at: CreatedAt
  updated_at: UpdatedAt
  deleted_at: DeletedAt
}

export interface AgentRunsTable {
  id: string
  conversation_id: string
  // 终答指针：指向 context_items 里的终答 assistant 条目；run 完成时回填（沿用「不设外键」约定）。
  final_item_id: ColumnType<string | null, string | null | undefined, string | null>
  agent_name: string
  status: ColumnType<AgentRunStatus, AgentRunStatus | undefined, AgentRunStatus>
  input: string
  error: ColumnType<string | null, string | null | undefined, string | null>
  created_at: CreatedAt
  updated_at: UpdatedAt
}

/**
 * 统一上下文事件日志（五期：模型自管理上下文）。取代 messages + agent_steps。
 * citations/meta/flags 为 jsonb，插入时显式 JSON.stringify。
 */
export interface ContextItemsTable {
  id: string
  conversation_id: string
  // RAG 单轮路径为 null；run 删除时置 null（消息独立于 run 存活）。
  run_id: ColumnType<string | null, string | null | undefined, string | null>
  kind: ContextItemKind
  content: string
  citations: JSONColumnType<Citation[], Citation[] | string | undefined, Citation[] | string>
  meta: JSONColumnType<ContextItemMeta, ContextItemMeta | string | undefined, ContextItemMeta | string>
  flags: JSONColumnType<ContextItemFlags, ContextItemFlags | string | undefined, ContextItemFlags | string>
  created_at: CreatedAt
}

/** 写操作两阶段确认的待确认记录。args 为工具入参快照（jsonb）。 */
export interface PendingOperationsTable {
  id: string
  conversation_id: string
  proposing_run_id: string
  tool_name: string
  args: JSONColumnType<Record<string, unknown>, Record<string, unknown> | string, never>
  description: string
  risk_reason: string
  status: ColumnType<
    'pending' | 'confirmed',
    'pending' | 'confirmed' | undefined,
    'pending' | 'confirmed'
  >
  created_at: CreatedAt
  updated_at: UpdatedAt
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
  chunk_embeddings: ChunkEmbeddingsTable
  conversations: ConversationsTable
  agent_runs: AgentRunsTable
  context_items: ContextItemsTable
  pending_operations: PendingOperationsTable
}

export type { Generated }
