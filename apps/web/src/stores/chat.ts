import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { ChatStreamEvent, Citation, Conversation, Message } from '@jnowledge/shared'
import { chatApi } from '@/apis/chat'
import { agentApi } from '@/apis/agent'

/** 流式执行轨迹的一步（仅 streaming 期间展示，不落库/不随消息保存）。 */
export interface TraceStep {
  seq: number
  kind: 'tool' | 'agent'
  name: string
  input: unknown
  running: boolean
  ok?: boolean
  summary?: string
}

export const useChatStore = defineStore('chat', () => {
  const collectionId = ref<string | null>(null)
  // 全局会话模式：不绑知识库，仅 agent（跨库检索）。与 collectionId 为 null 同义，但显式标记避免与「未加载」混淆。
  const isGlobal = ref(false)
  const conversations = ref<Conversation[]>([])
  const currentId = ref<string | null>(null)
  const messages = ref<Message[]>([])

  // Agent 模式开关：开 → 走自主编排的 agent 端点（带执行轨迹）；关 → 走 B 档 RAG。
  // 全局模式下恒为 agent（无 RAG 可选）。
  const agentMode = ref(false)

  // 流式中的助手草稿（未落库前的实时显示）。
  const streaming = ref(false)
  const streamText = ref('')
  const streamReasoning = ref('')
  const streamCitations = ref<Citation[]>([])
  // Agent 模式下的实时执行轨迹。
  const streamSteps = ref<TraceStep[]>([])

  /** 传 collection id → 知识库会话；传 null → 全局会话列表。 */
  async function loadConversations(cid: string | null) {
    collectionId.value = cid
    isGlobal.value = cid === null
    conversations.value = cid ? await chatApi.list(cid) : await chatApi.listGlobal()
  }

  async function open(id: string) {
    currentId.value = id
    const detail = await chatApi.detail(id)
    messages.value = detail.messages
  }

  async function create() {
    // 全局会话不带 collectionId；知识库会话必须有当前库。
    if (!isGlobal.value && !collectionId.value) return
    const cv = await chatApi.create(isGlobal.value ? {} : { collectionId: collectionId.value! })
    conversations.value.unshift(cv)
    currentId.value = cv.id
    messages.value = []
  }

  async function remove(id: string) {
    await chatApi.remove(id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (currentId.value === id) {
      currentId.value = null
      messages.value = []
    }
  }

  function resetStream() {
    streamText.value = ''
    streamReasoning.value = ''
    streamCitations.value = []
    streamSteps.value = []
  }

  async function ask(question: string) {
    if (!currentId.value || streaming.value) return
    const cid = currentId.value
    messages.value.push({
      id: `tmp-${messages.value.length}`,
      conversationId: cid,
      role: 'user',
      content: question,
      citations: [],
      createdAt: new Date().toISOString(),
    })
    streaming.value = true
    resetStream()

    // token/reasoning/citations/done/error 在两条路径上结构一致，公用此处理。
    const applyCommon = (ev: ChatStreamEvent) => {
      if (ev.type === 'token') streamText.value += ev.delta
      else if (ev.type === 'reasoning') streamReasoning.value += ev.delta
      else if (ev.type === 'citations') streamCitations.value = ev.citations
      else if (ev.type === 'done') {
        messages.value.push({
          id: ev.messageId,
          conversationId: cid,
          role: 'assistant',
          content: streamText.value,
          ...(streamReasoning.value ? { reasoning: streamReasoning.value } : {}),
          citations: streamCitations.value,
          createdAt: new Date().toISOString(),
        })
        resetStream()
      } else if (ev.type === 'error') {
        ElMessage.error(ev.message)
      }
    }

    try {
      // 全局会话只有 agent；知识库会话按开关。
      if (isGlobal.value || agentMode.value) {
        await agentApi.ask(cid, question, (ev) => {
          if (ev.type === 'step_start') {
            streamSteps.value.push({
              seq: ev.seq,
              kind: ev.kind,
              name: ev.name,
              input: ev.input,
              running: true,
            })
          } else if (ev.type === 'tool_result') {
            const s = streamSteps.value.find((x) => x.seq === ev.seq)
            if (s) {
              s.running = false
              s.ok = ev.ok
              s.summary = ev.summary
            }
          } else {
            // done 多带 runId，结构上仍兼容 ChatStreamEvent 的公共子集。
            applyCommon(ev as ChatStreamEvent)
          }
        })
      } else {
        await chatApi.ask(cid, question, applyCommon)
      }
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '提问失败')
    } finally {
      streaming.value = false
      resetStream()
      // 刷新会话列表（标题/排序可能变化）。全局会话传 null 重新拉全局列表。
      if (isGlobal.value || collectionId.value)
        loadConversations(collectionId.value).catch(() => undefined)
    }
  }

  return {
    collectionId,
    isGlobal,
    conversations,
    currentId,
    messages,
    agentMode,
    streaming,
    streamText,
    streamReasoning,
    streamCitations,
    streamSteps,
    loadConversations,
    open,
    create,
    remove,
    ask,
  }
})
