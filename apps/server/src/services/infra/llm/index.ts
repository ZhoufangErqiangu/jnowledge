import type { Config } from '../../../config/index.js'
import type { LlmTier } from '@jnowledge/shared'
import { createOpenAICapability } from './openaiAdapter.js'
import { type LLMCapability, type LLMClient, LlmError } from './types.js'

export * from './types.js'

/**
 * Tier → 模型绑定。一期集中在此处（业务代码永不出现模型名）。
 * 二期接 LLM 时再细分各 tier 的真实模型与默认参数。
 */
const TIER_MODELS: Record<LlmTier, string> = {
  heavy: 'gpt-4o',
  standard: 'gpt-4o',
  light: 'gpt-4o-mini',
  nano: 'gpt-4o-mini',
}

const EMBEDDING_MODEL = 'text-embedding-3-small'

/** 未配置供应商时的能力层：任何调用都给出清晰报错（CRUD 闭环不依赖 LLM）。 */
function unconfiguredCapability(): LLMCapability {
  const fail = (): never => {
    throw new LlmError('LLM 供应商未配置（设置 LLM_API_KEY）', 'unconfigured')
  }
  return {
    async text() {
      return fail()
    },
    async *textStream(): AsyncIterable<string> {
      fail()
      yield '' // 不可达：fail() 抛错，仅为满足 generator 语法
    },
    async object() {
      return fail()
    },
    async embed() {
      return fail()
    },
  }
}

export function createLLMClient(config: Config): LLMClient {
  const apiKey = config.llm.apiKey
  const configured = Boolean(apiKey)

  // 按 tier 懒建并缓存能力句柄。
  const cache = new Map<LlmTier, LLMCapability>()

  function capabilityFor(tier: LlmTier): LLMCapability {
    if (!apiKey) return unconfiguredCapability()
    const cached = cache.get(tier)
    if (cached) return cached
    const cap = createOpenAICapability({
      apiKey,
      baseUrl: config.llm.baseUrl,
      model: TIER_MODELS[tier],
      embeddingModel: EMBEDDING_MODEL,
    })
    cache.set(tier, cap)
    return cap
  }

  return {
    configured,
    tier(tier) {
      return capabilityFor(tier)
    },
  }
}
