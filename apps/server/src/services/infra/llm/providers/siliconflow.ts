import { z } from 'zod'
import type {
  AgentChunk,
  AgentTurnMessage,
  ChatMessage,
  Embedder,
  GenerateOptions,
  LLMCapability,
  ObjectOptions,
  Reranker,
  RerankHit,
  StreamChunk,
  TextOptions,
  ToolCall,
} from '../types.js'
import { LlmError } from '../types.js'

export interface SiliconFlowConfig {
  apiKey: string
  baseUrl: string
  model: string
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
}

/**
 * SiliconFlow chat 供应商实现（OpenAI 兼容 /chat/completions）。
 * 与 DeepSeek 同为 OpenAI 形状，但作为本供应商专属实现自持——差异点在 thinking 开关：
 * SiliconFlow（Qwen3 系）用布尔 `enable_thinking`，而非 DeepSeek 的 `{thinking:{type:'enabled'}}`。
 */
export class SiliconFlowChatProvider implements LLMCapability {
  private readonly chatUrl: string
  private readonly headers: Record<string, string>

  constructor(private readonly cfg: SiliconFlowConfig) {
    this.chatUrl = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`
    this.headers = authHeaders(cfg.apiKey)
  }

  private async rawChat(body: Record<string, unknown>): Promise<Response> {
    const res = await fetch(this.chatUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(`provider ${res.status}: ${detail.slice(0, 500)}`, 'provider')
    }
    return res
  }

  /** SiliconFlow（Qwen3 系）思考开关：布尔 enable_thinking。仅显式开启时注入，默认随模型。 */
  private thinkingBody(opts: { thinking?: boolean }): Record<string, unknown> {
    return opts.thinking ? { enable_thinking: true } : {}
  }

  async text(opts: TextOptions): Promise<string> {
    const res = await this.rawChat({
      model: opts.model ?? this.cfg.model,
      messages: buildMessages(opts),
      ...this.thinkingBody(opts),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    })
    const json = (await res.json()) as ChatCompletion
    return json.choices[0]?.message?.content ?? ''
  }

  async *textStream(opts: TextOptions): AsyncIterable<StreamChunk> {
    const res = await this.rawChat({
      model: opts.model ?? this.cfg.model,
      messages: buildMessages(opts),
      stream: true,
      ...this.thinkingBody(opts),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    })
    if (!res.body) throw new LlmError('流式响应无 body', 'provider')
    yield* parseSSE(res.body)
  }

  async object<T>(schema: z.ZodType<T>, opts: ObjectOptions): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' })
    const schemaText = JSON.stringify(jsonSchema)
    const maxRepair = opts.maxRepairAttempts ?? 2
    const baseMessages = buildMessages(opts)

    let lastErr = ''
    for (let attempt = 0; attempt <= maxRepair; attempt++) {
      const useStrict = attempt === 0
      const messages = useStrict
        ? baseMessages
        : injectSchema(baseMessages, schemaText, attempt > 1 ? lastErr : undefined)

      let res: Response
      try {
        res = await this.rawChat({
          model: opts.model ?? this.cfg.model,
          messages,
          response_format: useStrict
            ? { type: 'json_schema', json_schema: { name: 'result', schema: jsonSchema, strict: true } }
            : { type: 'json_object' },
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        })
      } catch (err) {
        if (useStrict) {
          res = await this.rawChat({
            model: opts.model ?? this.cfg.model,
            messages: injectSchema(baseMessages, schemaText),
            response_format: { type: 'json_object' },
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          })
        } else {
          throw err
        }
      }

      const json = (await res.json()) as ChatCompletion
      const raw = json.choices[0]?.message?.content ?? ''
      const parsed = safeJsonParse(raw)
      if (parsed.ok) {
        const result = schema.safeParse(parsed.value)
        if (result.success) return result.data
        lastErr = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      } else {
        lastErr = '非合法 JSON'
      }
    }
    throw new LlmError(`结构化输出校验失败（已重试 ${maxRepair} 次）：${lastErr}`, 'validation')
  }

  async *generateStream(opts: GenerateOptions): AsyncIterable<AgentChunk> {
    const res = await this.rawChat({
      model: this.cfg.model,
      messages: toApiMessages(opts.messages),
      tools: opts.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
      stream: true,
      ...this.thinkingBody(opts),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    })
    if (!res.body) throw new LlmError('流式响应无 body', 'provider')
    yield* parseToolStream(res.body)
  }
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

// ---- SiliconFlow（OpenAI 形状）chat 请求/响应辅助：本供应商专属，不外泄 ----

function buildMessages(opts: TextOptions): ChatMessage[] {
  if (opts.messages) return opts.messages
  const msgs: ChatMessage[] = []
  if (opts.system) msgs.push({ role: 'system', content: opts.system })
  if (opts.prompt) msgs.push({ role: 'user', content: opts.prompt })
  return msgs
}

/** AgentTurnMessage[] → OpenAI chat messages 形状（含 assistant.tool_calls / tool 角色）。 */
function toApiMessages(messages: AgentTurnMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }
    if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
          })),
        }
      }
      return { role: 'assistant', content: m.content ?? '' }
    }
    return { role: m.role, content: m.content }
  })
}

/** 把 JSON Schema 文本作为系统约束注入消息（json_object 降级路径用）。 */
function injectSchema(messages: ChatMessage[], schemaText: string, repairErr?: string): ChatMessage[] {
  const lines = [
    '你必须只返回一个合法 JSON 对象，且严格符合以下 JSON Schema；不要输出任何解释、注释或 markdown 代码块。',
    `JSON Schema: ${schemaText}`,
  ]
  if (repairErr) lines.push(`上次输出未通过校验：${repairErr}。请修正后仅返回合法 JSON。`)
  return [...messages, { role: 'system', content: lines.join('\n') }]
}

interface ChatCompletion {
  choices: { message?: { content?: string; reasoning_content?: string } }[]
}

function safeJsonParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    return { ok: true, value: JSON.parse(cleaned) }
  } catch {
    return { ok: false }
  }
}

/**
 * 解析带 tool-calling 的流：逐段 yield reasoning/text；累积 delta.tool_calls 分片，
 * 流结束时把每个 index 的 id/name/arguments 拼齐后一次性 yield。
 */
async function* parseToolStream(body: ReadableStream<Uint8Array>): AsyncIterable<AgentChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const acc = new Map<number, { id: string; name: string; args: string }>()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data) as {
          choices?: {
            delta?: {
              content?: string
              reasoning_content?: string
              tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
            }
          }[]
        }
        const delta = json.choices?.[0]?.delta
        if (delta?.reasoning_content) yield { type: 'reasoning', delta: delta.reasoning_content }
        if (delta?.content) yield { type: 'text', delta: delta.content }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            const cur = acc.get(idx) ?? { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name = tc.function.name
            if (tc.function?.arguments) cur.args += tc.function.arguments
            acc.set(idx, cur)
          }
        }
      } catch {
        // 忽略心跳/不完整分片
      }
    }
  }
  if (acc.size > 0) {
    const calls: ToolCall[] = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => {
        const parsed = c.args ? safeJsonParse(c.args) : { ok: true as const, value: {} }
        return { id: c.id, name: c.name, arguments: parsed.ok ? parsed.value : {} }
      })
    yield { type: 'tool_calls', calls }
  }
}

/** 解析 OpenAI 风格 SSE 流，分离 reasoning_content / content 两路逐段 yield。 */
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string; reasoning_content?: string } }[]
        }
        const delta = json.choices?.[0]?.delta
        if (delta?.reasoning_content) yield { type: 'reasoning', delta: delta.reasoning_content }
        if (delta?.content) yield { type: 'text', delta: delta.content }
      } catch {
        // 忽略心跳/不完整分片
      }
    }
  }
}
