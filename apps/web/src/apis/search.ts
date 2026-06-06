import type { SearchResponse } from '@jnowledge/shared'
import { http } from './http'

export const searchApi = {
  /** 全局检索：纯相关性排序的文档列表，无 LLM 推理。 */
  async search(query: string): Promise<SearchResponse> {
    const { data } = await http.post<SearchResponse>('/search', { query })
    return data
  },
}
