import type { ColumnType, JSONColumnType, Selectable } from 'kysely'
import type { Citation, ContextItemKind, ContextItemState } from '@jnowledge/shared'
import type { DB } from './schema.js'
import type { CreatedAt } from './columns.js'

/**
 * ContextItem 的表型 + jsonb 载荷形状 + Row/New + CRUD 全在此处。
 * 类型归 models（与 repo 同处一文件，沿用现有 *.repo.ts 约定）；db/types.ts 的 Database
 * manifest 仅 import 本表型做全局注册——这是 Kysely 要求的唯一闭合全表映射，不可消除。
 * 条目/状态枚举仍来自 @jnowledge/shared（跨平台词汇）。
 */

/** context_items.meta 里持久化的工具调用（与 runtime 的 ToolCall 同形，可无损互转）。 */
export interface ContextItemToolCall {
  id: string
  name: string
  arguments: unknown
}

/**
 * context_items.meta 的结构（按 kind 取用不同子集）：
 * - assistant 轮：toolCalls（本轮发起的工具调用，供 v2 跨轮无损重建）+ reasoning（本轮思考过程）。
 * - tool_result：seq/name/toolCallId/ok/error/summary/output（执行轨迹 + 诊断，取代 agent_steps）。
 */
export interface ContextItemMeta {
  toolCalls?: ContextItemToolCall[]
  /** assistant 轮的思考过程（thinking 开时）。不入 LLM/用户内容投影，仅展示/审计。 */
  reasoning?: string
  /**
   * 本条 assistant 对应的那次 LLM 调用的耗时与 token 用量（诊断/成本归因，调试上下文展示）。
   * 与 infra 的 LlmCallStat 同形、内联以免 models 反依赖 infra；usage 在供应商不回报时缺省。
   */
  llm?: {
    durationMs: number
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedPromptTokens?: number }
  }
  /**
   * 子推理 / 快照类别（仅 internal 状态条目用）：标注这条留痕来自哪个 stage——
   * safety=写操作安全判级；rag_filter=RAG 抽取式相关性过滤决策；
   * system=实际发送给模型的 system prompt 快照（§14.5：不重算重建，发送即快照，抗版本漂移）。
   */
  stage?: 'safety' | 'rag_filter' | 'system'
  /** 子推理的结构化判决留痕（如安全判级 verdict、过滤保留/丢弃明细）。 */
  verdict?: unknown
  seq?: number
  name?: string
  toolCallId?: string
  ok?: boolean
  error?: string | null
  summary?: string
  /** 工具入参快照（诊断用，取代 agent_steps.input）。 */
  input?: unknown
  /** 工具结构化输出（诊断用；content 列存的是 LLM 实际看到的字符串）。 */
  output?: unknown
}

/** context_items.flags：派生视图据此筛选；本期只写 state，其余留位。 */
export interface ContextItemFlags {
  state: ContextItemState
  pinned?: boolean
  protected?: boolean
  summarized?: boolean
}

/**
 * 统一上下文事件日志（五期：模型自管理上下文）。取代 messages + agent_steps。
 * citations/meta/flags 为 jsonb，插入时显式 JSON.stringify（见 insert）。
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

export type ContextItemRow = Selectable<ContextItemsTable>

export interface NewContextItem {
  id: string
  conversationId: string
  /** agent run 归属；RAG 单轮路径为 null。 */
  runId?: string | null
  kind: ContextItemKind
  content: string
  citations?: Citation[]
  meta?: ContextItemMeta
  /** 缺省 active（DB 默认）。 */
  flags?: ContextItemFlags
}

export function createContextItemRepo(db: DB) {
  return {
    /** 会话全量条目，按 (created_at, id) 全序——投影引擎据此重建视图。 */
    async listByConversation(conversationId: string): Promise<ContextItemRow[]> {
      return db
        .selectFrom('context_items')
        .selectAll()
        .where('conversation_id', '=', conversationId)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute()
    },

    /** 单次运行产生的全部条目（诊断用）。 */
    async listByRun(runId: string): Promise<ContextItemRow[]> {
      return db
        .selectFrom('context_items')
        .selectAll()
        .where('run_id', '=', runId)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute()
    },

    async insert(item: NewContextItem): Promise<ContextItemRow> {
      return db
        .insertInto('context_items')
        .values({
          id: item.id,
          conversation_id: item.conversationId,
          run_id: item.runId ?? null,
          kind: item.kind,
          content: item.content,
          // jsonb 需显式 JSON 序列化：node-postgres 会把 JS 数组/对象当成 PG 字面量，破坏 jsonb。
          citations: JSON.stringify(item.citations ?? []),
          meta: JSON.stringify(item.meta ?? {}),
          ...(item.flags ? { flags: JSON.stringify(item.flags) } : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },
  }
}

export type ContextItemRepo = ReturnType<typeof createContextItemRepo>
