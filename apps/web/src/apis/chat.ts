import type {
  ChatStreamEvent,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
} from '@jnowledge/shared'
import { ApiError, http, TOKEN_KEY } from './http'

export const chatApi = {
  async create(req: CreateConversationRequest): Promise<Conversation> {
    const { data } = await http.post<Conversation>('/conversations', req)
    return data
  },
  async list(collectionId: string): Promise<Conversation[]> {
    const { data } = await http.get<Conversation[]>(`/collections/${collectionId}/conversations`)
    return data
  },
  async detail(id: string): Promise<ConversationDetail> {
    const { data } = await http.get<ConversationDetail>(`/conversations/${id}`)
    return data
  },
  async remove(id: string): Promise<void> {
    await http.delete(`/conversations/${id}`)
  },

  /**
   * 提问（SSE）。用 fetch 读流（axios 不便于增量读取），逐个 data: 事件回调 onEvent。
   * 返回 Promise 在流结束时 resolve；可用 AbortSignal 中断。
   */
  async ask(
    conversationId: string,
    question: string,
    onEvent: (ev: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY)
    const res = await fetch(`/conversations/${conversationId}/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question }),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok || !res.body) {
      throw new ApiError('NETWORK', '提问失败', res.status)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 事件以空行分隔。
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const evt of events) {
        const dataLine = evt.split('\n').find((l) => l.startsWith('data:'))
        if (!dataLine) continue
        try {
          onEvent(JSON.parse(dataLine.slice(5).trim()) as ChatStreamEvent)
        } catch {
          // 忽略不完整/心跳分片
        }
      }
    }
  },
}
