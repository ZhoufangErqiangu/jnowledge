import type {
  ChatStreamEvent,
  ContextDebug,
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
  /** 全局会话列表（不绑库，仅 agent 模式）。 */
  async listGlobal(): Promise<Conversation[]> {
    const { data } = await http.get<Conversation[]>('/conversations')
    return data
  },
  async detail(id: string): Promise<ConversationDetail> {
    const { data } = await http.get<ConversationDetail>(`/conversations/${id}`)
    return data
  },
  async remove(id: string): Promise<void> {
    await http.delete(`/conversations/${id}`)
  },
  /** 调试：原始上下文 + 派生的推理视图 / 用户视图。 */
  async contextDebug(id: string): Promise<ContextDebug> {
    const { data } = await http.get<ContextDebug>(`/conversations/${id}/context/debug`)
    return data
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
