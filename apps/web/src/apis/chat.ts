import type {
  ContextDebug,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
} from '@jnowledge/shared'
import { http } from './http'

export const chatApi = {
  async create(req: CreateConversationRequest): Promise<Conversation> {
    const { data } = await http.post<Conversation>('/conversations', req)
    return data
  },
  /** 我的会话列表（统一为全局 agent 会话）。 */
  async list(): Promise<Conversation[]> {
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
}
