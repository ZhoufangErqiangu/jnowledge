import type { Selectable } from 'kysely'
import type { Citation, MessageRole } from '@jnowledge/shared'
import type { DB } from '../db/index.js'
import type { MessagesTable } from '../db/types.js'

export type MessageRow = Selectable<MessagesTable>

export interface NewMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  citations?: Citation[]
}

export function createMessageRepo(db: DB) {
  return {
    async listByConversation(conversationId: string): Promise<MessageRow[]> {
      return db
        .selectFrom('messages')
        .selectAll()
        .where('conversation_id', '=', conversationId)
        .orderBy('created_at', 'asc')
        .execute()
    },

    async insert(m: NewMessage): Promise<MessageRow> {
      return db
        .insertInto('messages')
        .values({
          id: m.id,
          conversation_id: m.conversationId,
          role: m.role,
          content: m.content,
          // 数组需显式 JSON 序列化：node-postgres 会把 JS 数组当成 PG 数组字面量，破坏 jsonb。
          citations: JSON.stringify(m.citations ?? []),
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },
  }
}

export type MessageRepo = ReturnType<typeof createMessageRepo>
