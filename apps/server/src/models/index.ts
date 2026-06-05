import type { DB } from './schema.js'
import { createUserRepo } from './user.repo.js'
import { createCollectionRepo } from './collection.repo.js'
import { createCollectionMemberRepo } from './collectionMember.repo.js'
import { createFileRepo } from './file.repo.js'
import { createDocumentRepo } from './document.repo.js'
import { createDocumentVersionRepo } from './documentVersion.repo.js'
import { createChunkRepo } from './chunk.repo.js'
import { createConversationRepo } from './conversation.repo.js'
import { createAgentRunRepo } from './agentRun.repo.js'
import { createContextItemRepo } from './contextItem.repo.js'
import { createPendingOperationRepo } from './pendingOperation.repo.js'

/** 组合根用：把某个执行器（db 或事务 trx）绑成一组 repository。 */
export function createModels(db: DB) {
  return {
    users: createUserRepo(db),
    collections: createCollectionRepo(db),
    collectionMembers: createCollectionMemberRepo(db),
    files: createFileRepo(db),
    documents: createDocumentRepo(db),
    documentVersions: createDocumentVersionRepo(db),
    chunks: createChunkRepo(db),
    conversations: createConversationRepo(db),
    agentRuns: createAgentRunRepo(db),
    contextItems: createContextItemRepo(db),
    pendingOperations: createPendingOperationRepo(db),
  }
}

export type Models = ReturnType<typeof createModels>

export * from './mappers.js'
