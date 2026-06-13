import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  type AgentRunNode,
  type Citation,
  type ContextItemDebug,
  type Conversation,
  type MainReasoningTier,
  type Message,
  projectForUser,
  viewFromDebug,
} from '@jnowledge/shared'
import { chatApi } from '@/apis/chat'
import { agentApi } from '@/apis/agent'

/** 子 agent 参与方泳道（DESIGN §8.9 方案 B）：同一 raw 模型上「轨迹/参与方」投影的一条。 */
export interface SubAgentLane {
  runId: string
  agentName: string
  /** run 树深度（顶层=0，rag_search 等子 agent≥1），用于缩进表达嵌套。 */
  depth: number
  reasoning: string
  text: string
  /** 子 agent 自身调的工具（如 knowledge_search）——内部轨迹，默认折叠。 */
  tools: { name: string; ok: boolean; summary: string }[]
  running: boolean
}

/** 一个顶层回合的派生视图：用户消息 + 助手答复 + 其子 agent 泳道（历史与在途同一形状）。 */
export interface TurnView {
  runId: string
  user: Message | null
  reasoning: string
  text: string
  citations: Citation[]
  /** 顶层 agent 自身调的工具（如 list_collections、文档改写）——默认折叠。 */
  tools: { name: string; ok: boolean; summary: string }[]
  subAgents: SubAgentLane[]
  /** 是否在途（顶层 run 尚无终答且正在流式）——决定光标。 */
  streaming: boolean
}

export const useChatStore = defineStore('chat', () => {
  // 会话统一为全局 agent 会话（库内 RAG 问答已退役；知识库检索走 /search）。
  const conversations = ref<Conversation[]>([])
  const currentId = ref<string | null>(null)

  // ——单一 raw 模型（DESIGN §8.9 阶段 4）：历史（reload 下发）与在途（SSE 增量）同住一处——
  const streaming = ref(false)
  /** 全量已落定条目（含 internal 子 agent 条目），按 (created_at,id) / 到达序。 */
  const rawItems = ref<ContextItemDebug[]>([])
  /** run 树（顶层 + 各子 agent）。 */
  const runs = ref<AgentRunNode[]>([])
  /** 各 run 未落定条目的累积增量（仅在途）。 */
  const openText = ref<Record<string, string>>({})
  const openReasoning = ref<Record<string, string>>({})

  // 主推理控制（仅作用于顶层推理；随每次提问下发）。
  const tier = ref<MainReasoningTier>('standard')
  const thinking = ref(true)

  const runById = computed(() => new Map(runs.value.map((r) => [r.id, r])))

  /** 沿 parentRunId 上溯到顶层 run id。 */
  function topOf(runId: string | null): string | null {
    let cur = runId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const parent = runById.value.get(cur)?.parentRunId ?? null
      if (!parent) return cur
      cur = parent
    }
    return cur
  }

  function runDepth(runId: string): number {
    let depth = 0
    let cur: string | null = runId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const parent: string | null = runById.value.get(cur)?.parentRunId ?? null
      if (!parent) break
      depth += 1
      cur = parent
    }
    return depth
  }

  function metaReasoning(i: ContextItemDebug): string {
    const r = (i.meta as { reasoning?: unknown }).reasoning
    return typeof r === 'string' ? r : ''
  }

  /** 某 run 的终答条目（assistant 且无 toolCalls）——存在即该 run 已出终答。 */
  function finalItemOf(runId: string): ContextItemDebug | undefined {
    return rawItems.value.find(
      (i) =>
        i.runId === runId &&
        i.kind === 'assistant' &&
        !((i.meta as { toolCalls?: unknown[] }).toolCalls?.length ?? 0),
    )
  }

  /** 某 run 自身的工具轨迹（tool_result，排除 system/scope 快照）。 */
  function toolsOf(runId: string): { name: string; ok: boolean; summary: string }[] {
    return rawItems.value
      .filter((i) => {
        const m = i.meta as { stage?: string }
        return i.runId === runId && i.kind === 'tool_result' && !m.stage
      })
      .map((i) => {
        const m = i.meta as { name?: string; ok?: boolean; summary?: string }
        return { name: m.name ?? '工具', ok: m.ok ?? false, summary: m.summary ?? '' }
      })
  }

  /**
   * 某 run 的助手展示（顶层与子 agent 同逻辑）：在途增量优先，缺省回落到已落定 assistant 条目内容——
   * 历史（无增量）走落定内容，在途走增量；不流式 text 的供应商 / 降级路径亦覆盖。
   */
  function deriveRun(runId: string): { reasoning: string; text: string; running: boolean } {
    const items = rawItems.value.filter((i) => i.runId === runId && i.kind === 'assistant')
    const settledText = items.map((i) => i.content).filter(Boolean).join('\n\n')
    const settledReasoning = items.map(metaReasoning).filter(Boolean).join('\n\n')
    return {
      reasoning: openReasoning.value[runId] || settledReasoning,
      text: openText.value[runId] || settledText,
      running: !finalItemOf(runId) && streaming.value,
    }
  }

  /** 统一派生：按顶层 run 切回合（历史 + 在途同一条管线）。 */
  const turns = computed<TurnView[]>(() => {
    // 顶层回合按首次出现序（rawItems 已全序）。
    const order: string[] = []
    const seen = new Set<string>()
    for (const it of rawItems.value) {
      const top = topOf(it.runId)
      if (top && !seen.has(top)) {
        seen.add(top)
        order.push(top)
      }
    }

    return order.map((R) => {
      const userItem = rawItems.value.find((i) => i.runId === R && i.kind === 'user')
      const user = userItem ? (projectForUser([viewFromDebug(userItem)])[0] ?? null) : null
      const subAgents: SubAgentLane[] = runs.value
        .filter((r) => r.parentRunId !== null && topOf(r.id) === R)
        .map((r) => ({
          runId: r.id,
          agentName: r.agentName,
          depth: runDepth(r.id),
          ...deriveRun(r.id),
          tools: toolsOf(r.id),
        }))
      const top = deriveRun(R)
      return {
        runId: R,
        user,
        reasoning: top.reasoning,
        text: top.text,
        citations: finalItemOf(R)?.citations ?? [],
        tools: toolsOf(R),
        subAgents,
        streaming: top.running,
      }
    })
  })

  async function loadConversations() {
    conversations.value = await chatApi.list()
  }

  function clearOpen() {
    openText.value = {}
    openReasoning.value = {}
  }

  async function open(id: string) {
    currentId.value = id
    clearOpen()
    const detail = await chatApi.detail(id)
    rawItems.value = detail.raw
    runs.value = detail.runs
  }

  async function create() {
    const cv = await chatApi.create({})
    conversations.value.unshift(cv)
    currentId.value = cv.id
    rawItems.value = []
    runs.value = []
    clearOpen()
  }

  async function remove(id: string) {
    await chatApi.remove(id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (currentId.value === id) {
      currentId.value = null
      rawItems.value = []
      runs.value = []
      clearOpen()
    }
  }

  async function ask(question: string) {
    if (!currentId.value || streaming.value) return
    const cid = currentId.value
    streaming.value = true
    clearOpen()

    try {
      await agentApi.ask(
        cid,
        question,
        (ev) => {
          if (ev.type === 'run') {
            if (!runs.value.some((r) => r.id === ev.node.id)) runs.value.push(ev.node)
          } else if (ev.type === 'item') {
            rawItems.value.push(ev.item)
          } else if (ev.type === 'patch') {
            const bucket = ev.field === 'text' ? openText : openReasoning
            bucket.value[ev.runId] = (bucket.value[ev.runId] ?? '') + ev.delta
          } else if (ev.type === 'error') {
            toast.error(ev.message)
          }
        },
        { tier: tier.value, thinking: thinking.value },
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '提问失败')
    } finally {
      streaming.value = false
      // 在途增量清空——本轮条目已落进 rawItems（携内容），turns 改由落定内容派生，无缝衔接。
      clearOpen()
      // 刷新会话列表（标题/排序可能变化）。
      loadConversations().catch(() => undefined)
    }
  }

  return {
    conversations,
    currentId,
    streaming,
    turns,
    tier,
    thinking,
    loadConversations,
    open,
    create,
    remove,
    ask,
  }
})
