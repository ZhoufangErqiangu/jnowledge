import type { Config } from '../../../config/index.js'
import { SiliconFlowReranker } from './providers/siliconflow.js'
import { type Reranker, type RerankService, LlmError } from './types.js'

type RerankConfig = Config['llm']['rerank']

/** rerank 领域 service：懒建底层 provider（SiliconFlow），未配置 key 时调用即清晰报错。 */
export function createRerankService(cfg: RerankConfig): RerankService {
  let reranker: Reranker | undefined
  function rerankerOf(): Reranker {
    if (!cfg.apiKey) {
      throw new LlmError('rerank 供应商未配置（设置对应 apiKey）', 'unconfigured')
    }
    reranker ??= new SiliconFlowReranker({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })
    return reranker
  }
  return {
    configured: Boolean(cfg.apiKey),
    rerank(query, documents, topN) {
      return rerankerOf().rerank(query, documents, topN)
    },
  }
}
