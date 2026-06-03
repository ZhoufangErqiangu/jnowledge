import { sql, type Selectable } from 'kysely'
import type { DB } from '../db/index.js'
import type { PendingOperationsTable } from '../db/types.js'

export type PendingOperationRow = Selectable<PendingOperationsTable>

export interface NewPendingOperation {
  id: string
  conversationId: string
  proposingRunId: string
  toolName: string
  args: Record<string, unknown>
  description: string
  riskReason: string
}

export function createPendingOperationRepo(db: DB) {
  return {
    async insert(op: NewPendingOperation): Promise<PendingOperationRow> {
      return db
        .insertInto('pending_operations')
        .values({
          id: op.id,
          conversation_id: op.conversationId,
          proposing_run_id: op.proposingRunId,
          tool_name: op.toolName,
          args: JSON.stringify(op.args),
          description: op.description,
          risk_reason: op.riskReason,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },

    async findById(id: string): Promise<PendingOperationRow | undefined> {
      return db.selectFrom('pending_operations').selectAll().where('id', '=', id).executeTakeFirst()
    },

    /** 一次性消费：仅当仍 pending 时置 confirmed，返回是否成功（防并发重复确认）。 */
    async markConfirmed(id: string): Promise<boolean> {
      const res = await db
        .updateTable('pending_operations')
        .set({ status: 'confirmed', updated_at: sql`now()` })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .executeTakeFirst()
      return Number(res.numUpdatedRows) > 0
    },
  }
}

export type PendingOperationRepo = ReturnType<typeof createPendingOperationRepo>
