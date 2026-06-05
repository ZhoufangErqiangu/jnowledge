import type { Config } from '../../../config/index.js'
import { createChatService } from './chat.js'
import { createEmbeddingService } from './embedding.js'
import { createRerankService } from './rerank.js'
import type { LLMClient } from './types.js'

export * from './types.js'

/**
 * 组合根：按领域拆分的三 service 聚合为 llm，与 config.llm.{chat,embedding,rerank} 一一对应。
 * 业务按领域取用：llm.chat.tier(...) / llm.embedding.embed(...) / llm.rerank.rerank(...)。
 */
export function createLLMClient(config: Config): LLMClient {
  return {
    chat: createChatService(config.llm.chat),
    embedding: createEmbeddingService(config.llm.embedding),
    rerank: createRerankService(config.llm.rerank),
  }
}
