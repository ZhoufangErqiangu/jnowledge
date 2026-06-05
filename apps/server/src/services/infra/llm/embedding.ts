import type { Config } from '../../../config/index.js'
import { SiliconFlowEmbedder } from './providers/siliconflow.js'
import { type Embedder, type EmbeddingService, LlmError } from './types.js'

type EmbeddingConfig = Config['llm']['embedding']

/** embedding 领域 service：懒建底层 provider（SiliconFlow），未配置 key 时调用即清晰报错。 */
export function createEmbeddingService(cfg: EmbeddingConfig): EmbeddingService {
  let embedder: Embedder | undefined
  function embedderOf(): Embedder {
    if (!cfg.apiKey) {
      throw new LlmError('embedding 供应商未配置（设置对应 apiKey）', 'unconfigured')
    }
    embedder ??= new SiliconFlowEmbedder({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })
    return embedder
  }
  return {
    configured: Boolean(cfg.apiKey),
    model: cfg.model,
    dim: cfg.dim,
    embed(input, opts) {
      return embedderOf().embed(input, opts?.model)
    },
  }
}
