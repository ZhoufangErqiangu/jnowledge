import { z } from 'zod'
import type {
  ChatMessage,
  EmbedOptions,
  LLMCapability,
  ObjectOptions,
  TextOptions,
} from './types.js'
import { LlmError } from './types.js'

export interface OpenAIAdapterConfig {
  apiKey: string
  baseUrl: string
  /** tier 绑定的对话模型 */
  model: string
  /** embedding 模型 */
  embeddingModel: string
}

function buildMessages(opts: TextOptions): ChatMessage[] {
  if (opts.messages) return opts.messages
  const msgs: ChatMessage[] = []
  if (opts.system) msgs.push({ role: 'system', content: opts.system })
  if (opts.prompt) msgs.push({ role: 'user', content: opts.prompt })
  return msgs
}

/**
 * OpenAI 兼容供应商适配器。仅用 fetch，不引 SDK。
 * 实现能力层的四个能力 + 结构化输出降级阶梯（json_schema → json_object + 校验重试）。
 */
export function createOpenAICapability(cfg: OpenAIAdapterConfig): LLMCapability {
  const chatUrl = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`
  const embedUrl = `${cfg.baseUrl.replace(/\/$/, '')}/embeddings`
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.apiKey}`,
  }

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
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      })
      const json = (await res.json()) as ChatCompletion
      return json.choices[0]?.message?.content ?? ''
    },

    async *textStream(opts) {
      const res = await rawChat({
        model: opts.model ?? cfg.model,
        messages: buildMessages(opts),
        stream: true,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      })
      if (!res.body) throw new LlmError('流式响应无 body', 'provider')
      yield* parseSSE(res.body)
    },

    async object<T>(schema: z.ZodType<T>, opts: ObjectOptions): Promise<T> {
      const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' })
      const maxRepair = opts.maxRepairAttempts ?? 2
      const messages = buildMessages(opts)

      let lastErr = ''
      for (let attempt = 0; attempt <= maxRepair; attempt++) {
        const attemptMessages: ChatMessage[] =
          attempt === 0
            ? messages
            : [
                ...messages,
                {
                  role: 'user',
                  content: `上次输出未通过 schema 校验：${lastErr}。请仅返回合法 JSON。`,
                },
              ]

        const res = await rawChat({
          model: opts.model ?? cfg.model,
          messages: attemptMessages,
          // 降级阶梯第一档：原生 json_schema；供应商不支持时回退到 json_object。
          response_format:
            attempt === 0
              ? {
                  type: 'json_schema',
                  json_schema: { name: 'result', schema: jsonSchema, strict: true },
                }
              : { type: 'json_object' },
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }).catch(async (err: unknown) => {
          // json_schema 不被支持 → 用 json_object 重试一次
          if (attempt === 0) {
            return rawChat({
              model: opts.model ?? cfg.model,
              messages: attemptMessages,
              response_format: { type: 'json_object' },
            })
          }
          throw err
        })

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

    async embed(input: string | string[], opts?: EmbedOptions) {
      const res = await fetch(embedUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: opts?.model ?? cfg.embeddingModel,
          input: Array.isArray(input) ? input : [input],
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new LlmError(`embed ${res.status}: ${detail.slice(0, 500)}`, 'provider')
      }
      const json = (await res.json()) as EmbeddingResponse
      return json.data.map((d) => d.embedding)
    },
  }
}

// ---- OpenAI 响应形状（最小集） ----
interface ChatCompletion {
  choices: { message?: { content?: string } }[]
}
interface EmbeddingResponse {
  data: { embedding: number[] }[]
}

function safeJsonParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  // 容忍模型偶发的 ```json 包裹
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return { ok: true, value: JSON.parse(cleaned) }
  } catch {
    return { ok: false }
  }
}

/** 解析 OpenAI 风格 SSE 流，逐段 yield delta 文本。 */
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
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
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
        const delta = json.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {
        // 忽略心跳/不完整分片
      }
    }
  }
}
