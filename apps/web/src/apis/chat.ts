import type {
  ChatStreamEvent,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
} from '@jnowledge/shared'
import { http } from './http'
import { streamSSE } from './sse'

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

  /** RAG 提问（SSE 流式）。逐个事件回调 onEvent；流结束 resolve，可用 AbortSignal 中断。 */
  async ask(
    conversationId: string,
    question: string,
    onEvent: (ev: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    await streamSSE<ChatStreamEvent>(
      `/conversations/${conversationId}/ask`,
      { question },
      onEvent,
      signal,
    )
  },
}
