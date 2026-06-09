import type { Embedder, Reranker, RerankHit, Thinking, ThinkingEffort } from '../types.js'
import { LlmError, normalizeThinking } from '../types.js'
import { type OpenAIChatConfig, OpenAIChatProvider } from './openai.js'

export type { OpenAIChatConfig as SiliconFlowConfig } from './openai.js'

function authHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
}

/**
 * SiliconFlow chat 供应商。OpenAI 形状的全部 wire 机制继承自 OpenAIChatProvider；
 * 唯一供应商特异处是 thinking 旋钮：SiliconFlow（Qwen3 系）用布尔 enable_thinking + thinking_budget，
 * 而非 DeepSeek 的 {thinking:{type:'enabled'}}。
 */
export class SiliconFlowChatProvider extends OpenAIChatProvider {
  /**
   * SiliconFlow 思考：布尔 enable_thinking + 可选 thinking_budget（CoT token 上限）。
   * - default（省略）：不发 enable_thinking，随模型默认。
   * - off（显式 false）：发 enable_thinking:false 真关（注：纯推理模型如 R1 可能不支持关、回 400）。
   * - on：enable_thinking:true + 预算。budgetTokens 优先，否则 effort→预算启发式表；都无则只开不设预算。
   * 官方文档：thinking_budget 取值范围 128–32768，无论来源都 clamp 到该区间再发。
   */
  protected thinkingBody(opts: { thinking?: Thinking }): Record<string, unknown> {
    const t = normalizeThinking(opts.thinking)
    if (t.mode === 'default') return {}
    if (t.mode === 'off') return { enable_thinking: false }
    const body: Record<string, unknown> = { enable_thinking: true }
    const budget = t.budgetTokens ?? effortToBudget(t.effort)
    if (budget !== undefined) body.thinking_budget = clampBudget(budget)
    return body
  }
}

/** SiliconFlow embedding 供应商实现（OpenAI 形状 /embeddings，本供应商专属自持）。 */
export class SiliconFlowEmbedder implements Embedder {
  private readonly url: string
  private readonly headers: Record<string, string>

  constructor(private readonly cfg: OpenAIChatConfig) {
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

  constructor(private readonly cfg: OpenAIChatConfig) {
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

// ---- SiliconFlow thinking_budget 映射：本供应商专属 ----

/** thinking_budget 官方取值范围（token）。 */
const MIN_THINKING_BUDGET = 128
const MAX_THINKING_BUDGET = 32768

/** 把预算夹到官方范围 [128, 32768]，越界会被 API 拒。 */
function clampBudget(n: number): number {
  return Math.max(MIN_THINKING_BUDGET, Math.min(MAX_THINKING_BUDGET, Math.round(n)))
}

/**
 * 归一化 effort → thinking_budget（token）的启发式映射。仅本供应商用，可按模型微调。
 * 数值取在官方范围 128–32768 内；high 直接给满预算。
 */
function effortToBudget(effort?: ThinkingEffort): number | undefined {
  switch (effort) {
    case 'low':
      return 4096
    case 'medium':
      return 16384
    case 'high':
      return MAX_THINKING_BUDGET
    default:
      return undefined
  }
}
