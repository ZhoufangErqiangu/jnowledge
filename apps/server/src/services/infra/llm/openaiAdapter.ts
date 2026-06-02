import { z } from 'zod'
import type {
  AgentChunk,
  AgentTurnMessage,
  ChatMessage,
  GenerateOptions,
  LLMCapability,
  ObjectOptions,
  RerankHit,
  StreamChunk,
  TextOptions,
  ToolCall,
} from './types.js'
import { LlmError } from './types.js'

export interface ChatAdapterConfig {
  apiKey: string
  baseUrl: string
  /** tier 绑定的对话模型 */
  model: string
  /** thinking 开关在请求体里的字段名（DeepSeek v4：默认 `thinking`） */
  thinkingField: string
}

export interface EmbedAdapterConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface RerankAdapterConfig {
  apiKey: string
  baseUrl: string
  model: string
}

function buildMessages(opts: TextOptions): ChatMessage[] {
  if (opts.messages) return opts.messages
  const msgs: ChatMessage[] = []
  if (opts.system) msgs.push({ role: 'system', content: opts.system })
  if (opts.prompt) msgs.push({ role: 'user', content: opts.prompt })
  return msgs
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
}

/**
 * thinking 请求体片段。仅在显式开启时注入（关闭依赖模型默认，避免发送供应商可能拒绝的 disabled 形状）。
 * DeepSeek v4 混合模型的开关参数是本仓唯一待官方最终确认处——若参数名/形状变更，仅改 config.thinkingField + 此函数。
 */
function thinkingBody(cfg: ChatAdapterConfig, opts: TextOptions): Record<string, unknown> {
  if (!opts.thinking) return {}
  return { [cfg.thinkingField]: { type: 'enabled' } }
}

/**
 * OpenAI 兼容 chat 适配器。仅用 fetch，不引 SDK。
 * 能力：text / textStream（分离 reasoning/content）/ object（json_schema → json_object + schema 注入 + 校验重试）。
 */
export function createChatCapability(cfg: ChatAdapterConfig): LLMCapability {
  const chatUrl = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = authHeaders(cfg.apiKey)

  async function rawChat(body: Record<string, unknown>): Promise<Response> {
    const res = await fetch(chatUrl, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(`provider ${res.status}: ${detail.slice(0, 500)}`, 'provider')
    }
    return res
  }

  return {
    async text(opts) {
      const res = await rawChat({
        model: opts.model ?? cfg.model,
        messages: buildMessages(opts),
        ...thinkingBody(cfg, opts),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      })
      const json = (await res.json()) as ChatCompletion
      // 仅返回最终答案；thinking 的 reasoning_content 在非流式下丢弃。
      return json.choices[0]?.message?.content ?? ''
    },

    async *textStream(opts) {
      const res = await rawChat({
        model: opts.model ?? cfg.model,
        messages: buildMessages(opts),
        stream: true,
        ...thinkingBody(cfg, opts),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      })
      if (!res.body) throw new LlmError('流式响应无 body', 'provider')
      yield* parseSSE(res.body)
    },

    async object<T>(schema: z.ZodType<T>, opts: ObjectOptions): Promise<T> {
      const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' })
      const schemaText = JSON.stringify(jsonSchema)
      const maxRepair = opts.maxRepairAttempts ?? 2
      const baseMessages = buildMessages(opts)

      let lastErr = ''
      for (let attempt = 0; attempt <= maxRepair; attempt++) {
        // 第 0 轮试原生 json_schema(strict)；其后用 json_object 并把 schema 文本注入 prompt
        // （DeepSeek 不支持 json_schema strict，且 json_object 要求 prompt 含 schema 约束与 "json" 字样）。
        const useStrict = attempt === 0
        const messages = useStrict
          ? baseMessages
          : injectSchema(baseMessages, schemaText, attempt > 1 ? lastErr : undefined)

        let res: Response
        try {
          res = await rawChat({
            model: opts.model ?? cfg.model,
            messages,
            response_format: useStrict
              ? {
                  type: 'json_schema',
                  json_schema: { name: 'result', schema: jsonSchema, strict: true },
                }
              : { type: 'json_object' },
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          })
        } catch (err) {
          // 供应商不支持 json_schema → 当轮立即降级到 json_object（注入 schema 文本）。
          if (useStrict) {
            res = await rawChat({
              model: opts.model ?? cfg.model,
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
    },

    async *generateStream(opts: GenerateOptions): AsyncIterable<AgentChunk> {
      const res = await rawChat({
        model: cfg.model,
        messages: toApiMessages(opts.messages),
        tools: opts.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: 'auto',
        stream: true,
        ...(opts.thinking ? { [cfg.thinkingField]: { type: 'enabled' } } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      })
      if (!res.body) throw new LlmError('流式响应无 body', 'provider')
      yield* parseToolStream(res.body)
    },
  }
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

/** SiliconFlow / OpenAI 兼容 embedding。 */
export function createEmbedder(cfg: EmbedAdapterConfig) {
  const embedUrl = `${cfg.baseUrl.replace(/\/$/, '')}/embeddings`
  const headers = authHeaders(cfg.apiKey)
  return async function embed(input: string | string[], model?: string): Promise<number[][]> {
    const res = await fetch(embedUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model ?? cfg.model,
        input: Array.isArray(input) ? input : [input],
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(`embed ${res.status}: ${detail.slice(0, 500)}`, 'provider')
    }
    const json = (await res.json()) as EmbeddingResponse
    // 按 index 排序，保证与输入次序一致。
    return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
  }
}

/** SiliconFlow rerank（Jina/Cohere 形状 `/rerank`）。 */
export function createReranker(cfg: RerankAdapterConfig) {
  const rerankUrl = `${cfg.baseUrl.replace(/\/$/, '')}/rerank`
  const headers = authHeaders(cfg.apiKey)
  return async function rerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<RerankHit[]> {
    if (documents.length === 0) return []
    const res = await fetch(rerankUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
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
    const json = (await res.json()) as RerankResponse
    return json.results.map((r) => ({ index: r.index, score: r.relevance_score }))
  }
}

/** 把 JSON Schema 文本作为系统约束注入消息（json_object 降级路径用）。 */
function injectSchema(
  messages: ChatMessage[],
  schemaText: string,
  repairErr?: string,
): ChatMessage[] {
  const lines = [
    '你必须只返回一个合法 JSON 对象，且严格符合以下 JSON Schema；不要输出任何解释、注释或 markdown 代码块。',
    `JSON Schema: ${schemaText}`,
  ]
  if (repairErr) lines.push(`上次输出未通过校验：${repairErr}。请修正后仅返回合法 JSON。`)
  return [...messages, { role: 'system', content: lines.join('\n') }]
}

// ---- 供应商响应形状（最小集） ----
interface ChatCompletion {
  choices: { message?: { content?: string; reasoning_content?: string } }[]
}
interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[]
}
interface RerankResponse {
  results: { index: number; relevance_score: number }[]
}

function safeJsonParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  // 容忍模型偶发的 ```json 包裹
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
 * 流结束时（finish_reason==='tool_calls'）把每个 index 的 id/name/arguments 拼齐后一次性 yield。
 */
async function* parseToolStream(body: ReadableStream<Uint8Array>): AsyncIterable<AgentChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // 按 tool_calls[].index 累积分片。
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
              tool_calls?: {
                index?: number
                id?: string
                function?: { name?: string; arguments?: string }
              }[]
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
