/**
 * 领域类型出口。
 * DTO 类型由各 schema 文件 z.infer 导出（单一真相源），这里统一以 type-only 再导出，
 * 供前端 `@jnowledge/shared/types` 按需引入，避免拖入 zod 运行时。
 */
export type { PaginationQuery, ErrorResponse } from '../schemas/common.js'
export type {
  RegisterRequest,
  LoginRequest,
  PublicUser,
  AuthResponse,
  JwtClaims,
} from '../schemas/auth.js'
export type {
  CollectionSettings,
  CreateCollectionRequest,
  UpdateCollectionRequest,
  Collection,
  CollectionTreeNode,
  AddMemberRequest,
  UpdateMemberRequest,
  CollectionMember,
} from '../schemas/collection.js'
export type { FileMeta } from '../schemas/file.js'
export type {
  CreateDocumentRequest,
  UpdateDocumentRequest,
  Document,
  DocumentVersion,
  DocumentVersionSummary,
  Chunk,
  DocumentDetail,
} from '../schemas/document.js'
export type {
  Citation,
  Message,
  Conversation,
  CreateConversationRequest,
  AskRequest,
  ConversationDetail,
  ChatStreamEvent,
} from '../schemas/chat.js'
export type { AgentRun, AgentStep, AgentAskRequest, AgentStreamEvent } from '../schemas/agent.js'

export type {
  UserRole,
  UserStatus,
  CollectionRole,
  DocumentSourceType,
  DocumentStatus,
  ContentFormat,
  LlmTier,
  MessageRole,
  AgentRunStatus,
  AgentStepKind,
  ContextItemKind,
  ContextItemState,
} from '../constants/enums.js'
export type { ErrorCode } from '../constants/errors.js'
