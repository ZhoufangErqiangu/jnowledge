import type { Kysely } from 'kysely'

/**
 * 五期 §14.2 使能原语：run 树。
 * agent_runs 加 parent_run_id 表达嵌套推理（子 agent 作工具时指向发起它的父 run）。
 * - 自引用 FK，ON DELETE SET NULL：删父 run 不连带删子 run（轨迹独立存活，沿用 run_id 约定）。
 * - 顶层 run 的 parent_run_id 为 null。
 * - 子 run 分配独立 runId（agentAsTool 不再复用父 runId），其全过程按 context_items 第三状态留痕。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('agent_runs')
    .addColumn('parent_run_id', 'uuid', (c) => c.references('agent_runs.id').onDelete('set null'))
    .execute()

  // 按父 run 取子 run（debug 页重建调用树）。
  await db.schema
    .createIndex('agent_runs_parent_idx')
    .on('agent_runs')
    .column('parent_run_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('agent_runs_parent_idx').ifExists().execute()
  await db.schema.alterTable('agent_runs').dropColumn('parent_run_id').execute()
}
