import { sql, type Selectable } from 'kysely'
import type { AgentRunStatus } from '@jnowledge/shared'
import type { AgentRunsTable, DB } from './schema.js'

export type AgentRunRow = Selectable<AgentRunsTable>

export interface NewAgentRun {
  id: string
  conversationId: string
  /** 父 run（嵌套推理）；顶层 run 省略/为 null。 */
  parentRunId?: string | null
  agentName: string
  input: string
}

export function createAgentRunRepo(db: DB) {
  return {
    async findById(id: string): Promise<AgentRunRow | undefined> {
      return db.selectFrom('agent_runs').selectAll().where('id', '=', id).executeTakeFirst()
    },

    async listByConversation(conversationId: string): Promise<AgentRunRow[]> {
      return db
        .selectFrom('agent_runs')
        .selectAll()
        .where('conversation_id', '=', conversationId)
        .orderBy('created_at', 'asc')
        .execute()
    },

    /** 建 run，默认 status=running（DB 默认值）。 */
    async insert(r: NewAgentRun): Promise<AgentRunRow> {
      return db
        .insertInto('agent_runs')
        .values({
          id: r.id,
          conversation_id: r.conversationId,
          parent_run_id: r.parentRunId ?? null,
          agent_name: r.agentName,
          input: r.input,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },

    /** 运行成功：回填终答 context_item id + status=completed。 */
    async complete(id: string, finalItemId: string): Promise<void> {
      await db
        .updateTable('agent_runs')
        .set({ status: 'completed', final_item_id: finalItemId, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },

    /** 运行失败/熔断：记 status=failed + error。 */
    async fail(id: string, error: string): Promise<void> {
      await db
        .updateTable('agent_runs')
        .set({ status: 'failed' satisfies AgentRunStatus, error, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },
  }
}

export type AgentRunRepo = ReturnType<typeof createAgentRunRepo>
