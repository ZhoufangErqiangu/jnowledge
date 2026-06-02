import type {
  AgentRun,
  AgentStep,
  Chunk,
  Collection,
  CollectionMember,
  Conversation,
  Document,
  DocumentVersion,
  DocumentVersionSummary,
  FileMeta,
  Message,
  PublicUser,
} from '@jnowledge/shared'
import type { UserRow } from './user.repo.js'
import type { CollectionRow } from './collection.repo.js'
import type { MemberWithUserRow } from './collectionMember.repo.js'
import type { FileRow } from './file.repo.js'
import type { DocumentRow } from './document.repo.js'
import type { DocumentVersionRow } from './documentVersion.repo.js'
import type { ChunkRow } from './chunk.repo.js'
import type { ConversationRow } from './conversation.repo.js'
import type { MessageRow } from './message.repo.js'
import type { AgentRunRow } from './agentRun.repo.js'
import type { AgentStepRow } from './agentStep.repo.js'

const iso = (d: Date): string => new Date(d).toISOString()

export function toPublicUser(r: UserRow): PublicUser {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    createdAt: iso(r.created_at),
  }
}

export function toCollection(r: CollectionRow): Collection {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    ownerId: r.owner_id,
    description: r.description,
    settings: r.settings,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

export function toCollectionMember(r: MemberWithUserRow): CollectionMember {
  return {
    collectionId: r.collection_id,
    role: r.role,
    user: toPublicUser(r.user),
    createdAt: iso(r.created_at),
  }
}

export function toFileMeta(r: FileRow): FileMeta {
  return {
    id: r.id,
    mimeType: r.mime_type,
    fileSize: Number(r.file_size),
    checksum: r.checksum,
    originalName: r.original_name,
    createdAt: iso(r.created_at),
  }
}

export function toDocument(r: DocumentRow): Document {
  return {
    id: r.id,
    collectionId: r.collection_id,
    title: r.title,
    sourceType: r.source_type,
    currentVersionId: r.current_version_id,
    status: r.status,
    statusError: r.status_error,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

export function toDocumentVersion(r: DocumentVersionRow): DocumentVersion {
  return {
    id: r.id,
    documentId: r.document_id,
    versionNo: r.version_no,
    content: r.content,
    contentFormat: r.content_format,
    checksum: r.checksum,
    sourceFileId: r.source_file_id,
    authorId: r.author_id,
    createdAt: iso(r.created_at),
  }
}

export function toDocumentVersionSummary(r: DocumentVersionRow): DocumentVersionSummary {
  const { content: _content, ...rest } = toDocumentVersion(r)
  return rest
}

export function toChunk(r: ChunkRow): Chunk {
  return {
    id: r.id,
    documentVersionId: r.document_version_id,
    seq: r.seq,
    content: r.content,
    tokenCount: r.token_count,
    charStart: r.char_start,
    charEnd: r.char_end,
    headingPath: r.heading_path,
  }
}

export function toConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    collectionId: r.collection_id,
    title: r.title,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

export function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    // jsonb 由 pg 解析为 JS；空表默认 []。
    citations: (r.citations ?? []) as Message['citations'],
    createdAt: iso(r.created_at),
  }
}

export function toAgentRun(r: AgentRunRow): AgentRun {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    agentName: r.agent_name,
    status: r.status,
    input: r.input,
    error: r.error,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

export function toAgentStep(r: AgentStepRow): AgentStep {
  return {
    id: r.id,
    runId: r.run_id,
    seq: r.seq,
    kind: r.kind,
    name: r.name,
    // jsonb 由 pg 解析为 JS。
    input: r.input ?? null,
    output: r.output ?? null,
    error: r.error,
    createdAt: iso(r.created_at),
  }
}
