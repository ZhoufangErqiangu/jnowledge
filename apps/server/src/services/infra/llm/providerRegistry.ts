import { DeepSeekChatProvider } from './providers/deepseek.js'
import { SiliconFlowChatProvider } from './providers/siliconflow.js'
import { type LLMCapability, LlmError } from './types.js'

/**
 * 三层路由的产物：tier→模型→供应商解析完成后，建 chat provider 所需的全部信息。
 * providerKind 决定实例化哪个 provider class；其余是该 class 建连/选模所需参数。
 */
export interface ResolvedModel {
  /** 模型逻辑名（缓存与报错用）。 */
  key: string
  /** 供应商实现判别，第三层路由的依据。 */
  providerKind: 'deepseek' | 'siliconflow'
  apiKey: string
  baseUrl: string
  /** 供应商侧真实模型 id（发给 API 的 model 字段）。 */
  modelId: string
  /** thinking 字段名（DeepSeek 用）。 */
  thinkingField: string
}

/**
 * ③ 第三层：按供应商 kind 选中并实例化具体的 provider class。
 * 新增供应商 = config providers.kind 扩枚举 + 写一个 implements LLMCapability 的 class + 在此加一个 case。
 * 上两层（tier→模型、模型→供应商）不需任何改动。
 */
export function createChatProvider(rm: ResolvedModel): LLMCapability {
  switch (rm.providerKind) {
    case 'deepseek':
      return new DeepSeekChatProvider({
        apiKey: rm.apiKey,
        baseUrl: rm.baseUrl,
        model: rm.modelId,
        thinkingField: rm.thinkingField,
      })
    case 'siliconflow':
      // SiliconFlow 自带 thinking 形状（enable_thinking），不吃 thinkingField。
      return new SiliconFlowChatProvider({
        apiKey: rm.apiKey,
        baseUrl: rm.baseUrl,
        model: rm.modelId,
      })
    default:
      // 类型上 providerKind 已被 config 的 z.enum 收窄；此处兜底未来漏接的 kind。
      throw new LlmError(`未接入的供应商 kind: ${rm.providerKind as string}`, 'provider')
  }
}
