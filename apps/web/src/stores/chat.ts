import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { Citation, Conversation, Message } from '@jnowledge/shared'
import { chatApi } from '@/apis/chat'

export const useChatStore = defineStore('chat', () => {
  const collectionId = ref<string | null>(null)
  const conversations = ref<Conversation[]>([])
  const currentId = ref<string | null>(null)
  const messages = ref<Message[]>([])

  // 流式中的助手草稿（未落库前的实时显示）。
  const streaming = ref(false)
  const streamText = ref('')
  const streamReasoning = ref('')
  const streamCitations = ref<Citation[]>([])

  async function loadConversations(cid: string) {
    collectionId.value = cid
    conversations.value = await chatApi.list(cid)
  }

  async function open(id: string) {
    currentId.value = id
    const detail = await chatApi.detail(id)
    messages.value = detail.messages
  }

  async function create() {
    if (!collectionId.value) return
    const cv = await chatApi.create({ collectionId: collectionId.value })
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
      await chatApi.ask(cid, question, (ev) => {
        if (ev.type === 'token') streamText.value += ev.delta
        else if (ev.type === 'reasoning') streamReasoning.value += ev.delta
        else if (ev.type === 'citations') streamCitations.value = ev.citations
        else if (ev.type === 'done') {
          messages.value.push({
            id: ev.messageId,
            conversationId: cid,
            role: 'assistant',
            content: streamText.value,
            citations: streamCitations.value,
            createdAt: new Date().toISOString(),
          })
          resetStream()
        } else if (ev.type === 'error') {
          ElMessage.error(ev.message)
        }
      })
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '提问失败')
    } finally {
      streaming.value = false
      resetStream()
      // 刷新会话列表（标题/排序可能变化）。
      if (collectionId.value) loadConversations(collectionId.value).catch(() => undefined)
    }
  }

  return {
    collectionId,
    conversations,
    currentId,
    messages,
    streaming,
    streamText,
    streamReasoning,
    streamCitations,
    loadConversations,
    open,
    create,
    remove,
    ask,
  }
})
