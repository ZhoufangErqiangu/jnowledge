import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { Citation, Conversation, MainReasoningTier, Message } from '@jnowledge/shared'
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
  // 会话统一为全局 agent 会话（库内 RAG 问答已退役；知识库检索走 /search）。
  const conversations = ref<Conversation[]>([])
  const currentId = ref<string | null>(null)
  const messages = ref<Message[]>([])

  // 流式中的助手草稿（未落库前的实时显示）。
  const streaming = ref(false)
  const streamText = ref('')
  const streamReasoning = ref('')
  const streamCitations = ref<Citation[]>([])
  // Agent 模式下的实时执行轨迹。
  const streamSteps = ref<TraceStep[]>([])

  // 主推理控制（仅作用于顶层推理；随每次提问下发）。
  const tier = ref<MainReasoningTier>('standard')
  const thinking = ref(true)

  async function loadConversations() {
    conversations.value = await chatApi.list()
  }

  async function open(id: string) {
    currentId.value = id
    const detail = await chatApi.detail(id)
    messages.value = detail.messages
  }

  async function create() {
    const cv = await chatApi.create({})
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

    try {
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
        } else if (ev.type === 'token') {
          streamText.value += ev.delta
        } else if (ev.type === 'reasoning') {
          streamReasoning.value += ev.delta
        } else if (ev.type === 'citations') {
          streamCitations.value = ev.citations
        } else if (ev.type === 'done') {
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
          toast.error(ev.message)
        }
      }, { tier: tier.value, thinking: thinking.value })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '提问失败')
    } finally {
      streaming.value = false
      resetStream()
      // 刷新会话列表（标题/排序可能变化）。
      loadConversations().catch(() => undefined)
    }
  }

  return {
    conversations,
    currentId,
    messages,
    streaming,
    streamText,
    streamReasoning,
    streamCitations,
    streamSteps,
    tier,
    thinking,
    loadConversations,
    open,
    create,
    remove,
    ask,
  }
})
