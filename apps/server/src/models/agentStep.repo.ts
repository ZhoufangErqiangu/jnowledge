import type { Selectable } from 'kysely'
import type { AgentStepKind } from '@jnowledge/shared'
import type { DB } from '../db/index.js'
import type { AgentStepsTable } from '../db/types.js'

export type AgentStepRow = Selectable<AgentStepsTable>

export interface NewAgentStep {
  id: string
  runId: string
  seq: number
  kind: AgentStepKind
  name?: string | null
  input?: unknown
  output?: unknown
  error?: string | null
}

export function createAgentStepRepo(db: DB) {
  return {
    async listByRun(runId: string): Promise<AgentStepRow[]> {
      return db
        .selectFrom('agent_steps')
        .selectAll()
        .where('run_id', '=', runId)
        .orderBy('seq', 'asc')
        .execute()
    },

    async insert(s: NewAgentStep): Promise<AgentStepRow> {
      return db
        .insertInto('agent_steps')
        .values({
          id: s.id,
          run_id: s.runId,
          seq: s.seq,
          kind: s.kind,
          name: s.name ?? null,
          // jsonb 需显式 JSON 序列化（node-postgres 会把 JS 值当数组字面量，破坏 jsonb）。
          input: s.input === undefined ? null : JSON.stringify(s.input),
          output: s.output === undefined ? null : JSON.stringify(s.output),
          error: s.error ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },
  }
}

export type AgentStepRepo = ReturnType<typeof createAgentStepRepo>
