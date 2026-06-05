import { type Embedder, type Reranker, type RerankHit, LlmError } from '../types.js'

export interface SiliconFlowConfig {
  apiKey: string
  baseUrl: string
  model: string
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
}

/** SiliconFlow embedding 供应商实现（OpenAI 形状 /embeddings，本供应商专属自持）。 */
export class SiliconFlowEmbedder implements Embedder {
  private readonly url: string
  private readonly headers: Record<string, string>

  constructor(private readonly cfg: SiliconFlowConfig) {
    this.url = `${cfg.baseUrl.replace(/\/$/, '')}/embeddings`
    this.headers = authHeaders(cfg.apiKey)
  }

  async embed(input: string | string[], model?: string): Promise<number[][]> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: model ?? this.cfg.model,
        input: Array.isArray(input) ? input : [input],
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(`embed ${res.status}: ${detail.slice(0, 500)}`, 'provider')
    }
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] }
    // 按 index 排序，保证与输入次序一致。
    return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
  }
}

/** SiliconFlow rerank 供应商实现（Jina/Cohere 形状 /rerank，本供应商专属自持）。 */
export class SiliconFlowReranker implements Reranker {
  private readonly url: string
  private readonly headers: Record<string, string>

  constructor(private readonly cfg: SiliconFlowConfig) {
    this.url = `${cfg.baseUrl.replace(/\/$/, '')}/rerank`
    this.headers = authHeaders(cfg.apiKey)
  }

  async rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]> {
    if (documents.length === 0) return []
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.cfg.model,
        query,
        documents,
        top_n: topN,
        return_documents: false,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(`rerank ${res.status}: ${detail.slice(0, 500)}`, 'provider')
    }
    const json = (await res.json()) as { results: { index: number; relevance_score: number }[] }
    return json.results.map((r) => ({ index: r.index, score: r.relevance_score }))
  }
}
