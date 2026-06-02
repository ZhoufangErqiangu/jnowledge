import type { Config } from '../../../config/index.js'
import type { LlmTier } from '@jnowledge/shared'
import { createChatCapability, createEmbedder, createReranker } from './openaiAdapter.js'
import { type LLMCapability, type LLMClient, LlmError } from './types.js'

export * from './types.js'

/** 未配置 chat 供应商时的能力层：任何调用都给出清晰报错（CRUD 闭环不依赖 LLM）。 */
function unconfiguredCapability(): LLMCapability {
  const fail = (): never => {
    throw new LlmError('chat 供应商未配置（设置 DEEPSEEK_API_KEY）', 'unconfigured')
  }
  return {
    async text() {
      return fail()
    },
    async *textStream() {
      fail()
      yield { type: 'text' as const, delta: '' } // 不可达：fail() 抛错，仅为满足 generator 语法
    },
    async object() {
      return fail()
    },
    async *generateStream() {
      fail()
      yield { type: 'text' as const, delta: '' } // 不可达：fail() 抛错，仅为满足 generator 语法
    },
  }
}

export function createLLMClient(config: Config): LLMClient {
  const { chat, embedding, rerank } = config.llm
  const configured = Boolean(chat.apiKey)
  const embeddingConfigured = Boolean(embedding.apiKey)

  // 按 tier 懒建并缓存 chat 能力句柄。
  const chatCache = new Map<LlmTier, LLMCapability>()
  function capabilityFor(tier: LlmTier): LLMCapability {
    if (!chat.apiKey) return unconfiguredCapability()
    const cached = chatCache.get(tier)
    if (cached) return cached
    const cap = createChatCapability({
      apiKey: chat.apiKey,
      baseUrl: chat.baseUrl,
      model: chat.models[tier],
      thinkingField: chat.thinkingField,
    })
    chatCache.set(tier, cap)
    return cap
  }

  // embed / rerank 走 SiliconFlow 侧，懒建。
  let embedder: ReturnType<typeof createEmbedder> | undefined
  let reranker: ReturnType<typeof createReranker> | undefined
  function embedderOf() {
    if (!embedding.apiKey) {
      throw new LlmError('embedding 供应商未配置（设置 SILICONFLOW_API_KEY）', 'unconfigured')
    }
    embedder ??= createEmbedder({
      apiKey: embedding.apiKey,
      baseUrl: embedding.baseUrl,
      model: embedding.model,
    })
    return embedder
  }
  function rerankerOf() {
    if (!rerank.apiKey) {
      throw new LlmError('rerank 供应商未配置（设置 SILICONFLOW_API_KEY）', 'unconfigured')
    }
    reranker ??= createReranker({
      apiKey: rerank.apiKey,
      baseUrl: rerank.baseUrl,
      model: rerank.model,
    })
    return reranker
  }

  return {
    configured,
    embeddingConfigured,
    embeddingModel: embedding.model,
    embeddingDim: embedding.dim,
    tier(tier) {
      return capabilityFor(tier)
    },
    embed(input, opts) {
      return embedderOf()(input, opts?.model)
    },
    rerank(query, documents, topN) {
      return rerankerOf()(query, documents, topN)
    },
  }
}
