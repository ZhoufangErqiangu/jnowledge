import type { Config } from '../../../config/index.js'
import type { LlmTier } from '@jnowledge/shared'
import { createChatProvider } from './providerRegistry.js'
import { type ChatService, type LLMCapability, LlmError } from './types.js'

type ChatConfig = Config['llm']['chat']

/** 未配置 chat 供应商时的能力层：任何调用都给出清晰报错（CRUD 闭环不依赖 LLM）。 */
function unconfiguredCapability(provider: string): LLMCapability {
  const fail = (): never => {
    throw new LlmError(`chat 供应商「${provider}」未配置 apiKey`, 'unconfigured')
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

/**
 * chat 领域 service：tier→模型→供应商三层路由。
 *   ① tier → 模型逻辑名（tiers）
 *   ② 模型逻辑名 → 注册表项（models）
 *   ③ 模型的 provider → 连接信息 + kind，kind 决定走哪套 adapter（providers + providerRegistry）
 */
export function createChatService(chat: ChatConfig): ChatService {
  const { providers, models, tiers } = chat

  // chat 侧「是否可用」：所有被 tier 引用的供应商都配了 key 才算就绪（保持粗粒度旧语义）。
  const configured = [...new Set(Object.values(tiers).map((k) => models[k]?.provider))].every(
    (p) => Boolean(p && providers[p]?.apiKey),
  )

  // 按模型逻辑名懒建并缓存 chat 能力句柄（多 tier 指同一模型则共享一个句柄）。
  const cache = new Map<string, LLMCapability>()
  function capabilityFor(tier: LlmTier): LLMCapability {
    // ① tier → 模型逻辑名
    const modelKey = tiers[tier]
    // ② 模型逻辑名 → 注册表项
    const modelCfg = models[modelKey]
    if (!modelCfg) {
      throw new LlmError(`tier「${tier}」指向未注册模型「${modelKey}」`, 'unconfigured')
    }
    // ③ 模型 → 供应商
    const providerCfg = providers[modelCfg.provider]
    if (!providerCfg) {
      throw new LlmError(
        `模型「${modelKey}」指向未注册供应商「${modelCfg.provider}」`,
        'unconfigured',
      )
    }
    if (!providerCfg.apiKey) return unconfiguredCapability(modelCfg.provider)

    const cached = cache.get(modelKey)
    if (cached) return cached
    const cap = createChatProvider({
      key: modelKey,
      providerKind: providerCfg.kind,
      apiKey: providerCfg.apiKey,
      baseUrl: providerCfg.baseUrl,
      modelId: modelCfg.model,
      thinkingField: providerCfg.thinkingField,
    })
    cache.set(modelKey, cap)
    return cap
  }

  return {
    configured,
    tier(tier) {
      return capabilityFor(tier)
    },
  }
}
