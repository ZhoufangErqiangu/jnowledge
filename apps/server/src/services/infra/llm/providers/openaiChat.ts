import { z } from 'zod'
import type {
  AgentChunk,
  AgentTurnMessage,
  ChatMessage,
  GenerateOptions,
  LLMCapability,
  LlmCallStat,
  LlmUsage,
  ObjectOptions,
  StreamChunk,
  TextOptions,
  Thinking,
  ToolCall,
} from '../types.js'
import { LlmError } from '../types.js'

export interface OpenAIChatConfig {
  apiKey: string
  baseUrl: string
  /** tier 解析出的真实模型 id（发给 API 的 model 字段）。 */
  model: string
}

/**
 * OpenAI 兼容 /chat/completions 的抽象基类。
 * 行业现状：chat API 收敛为「OpenAI 形状」「Anthropic 形状」两大类。同属 OpenAI 形状的供应商
 * （DeepSeek / SiliconFlow / …）共享全部 wire 机制——建连、消息拼装、SSE 解析、json_schema→json_object
 * 降级与校验重试、ReAct tool-calling 流。唯一因供应商而异的是 thinking 旋钮的拼法，由子类实现 thinkingBody。
 *
 * 能力：text / textStream（分离 reasoning/content）/ object（结构化输出 + 校验重试）/ generateStream（工具流）。
 * 仅用 fetch，不引 SDK。
 */
export abstract class OpenAIChatProvider implements LLMCapability {
  protected readonly cfg: OpenAIChatConfig
  private readonly chatUrl: string
  private readonly headers: Record<string, string>

  constructor(cfg: OpenAIChatConfig) {
    this.cfg = cfg
    this.chatUrl = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`
    this.headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }
  }

  /**
   * 子类实现：把归一化的 thinking 选项映射成本供应商的请求体片段。
   * 约定：default（省略）应返回 {}（不发任何 thinking 字段，随模型默认）。
   */
  protected abstract thinkingBody(opts: { thinking?: Thinking }): Record<string, unknown>

  private async rawChat(body: Record<string, unknown>, timeoutMs?: number): Promise<Response> {
    const ms = timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    // AbortSignal.timeout 覆盖整次请求生命周期（建连 + 流式 body 读取）：无响应/中途 stall 都会被 abort，
    // 把"挂死"转成可熔断的 timeout 错误（流式 body 的 reader.read() 也会随之 reject，见 wrapAbort）。
    let res: Response
    try {
      res = await fetch(this.chatUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      })
    } catch (err) {
      throw asTimeoutOrRethrow(err, ms)
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(`provider ${res.status}: ${detail.slice(0, 500)}`, 'provider')
    }
    return res
  }

  async text(opts: TextOptions): Promise<string> {
    const startedAt = Date.now()
    const res = await this.rawChat(
      {
        model: opts.model ?? this.cfg.model,
        messages: buildMessages(opts),
        ...this.thinkingBody(opts),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      },
      opts.timeoutMs,
    )
    const json = (await res.json()) as ChatCompletion
    emitStat(opts, startedAt, json.usage)
    // 仅返回最终答案；thinking 的 reasoning_content 在非流式下丢弃。
    return json.choices[0]?.message?.content ?? ''
  }

  async *textStream(opts: TextOptions): AsyncIterable<StreamChunk> {
    const res = await this.rawChat(
      {
        model: opts.model ?? this.cfg.model,
        messages: buildMessages(opts),
        stream: true,
        ...this.thinkingBody(opts),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      },
      opts.timeoutMs,
    )
    if (!res.body) throw new LlmError('流式响应无 body', 'provider')
    yield* wrapAbort(parseSSE(res.body), opts.timeoutMs)
  }

  async object<T>(schema: z.ZodType<T>, opts: ObjectOptions): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' })
    const schemaText = JSON.stringify(jsonSchema)
    const maxRepair = opts.maxRepairAttempts ?? 2
    const baseMessages = buildMessages(opts)

    let lastErr = ''
    // 跨重试计时：耗时归到整次 object() 调用（含降级/修复重试，反映真实代价）。
    const startedAt = Date.now()
    for (let attempt = 0; attempt <= maxRepair; attempt++) {
      // 第 0 轮试原生 json_schema(strict)；其后用 json_object 并把 schema 文本注入 prompt
      // （多数 OpenAI 兼容供应商不支持 json_schema strict，且 json_object 要求 prompt 含 schema 约束与 "json" 字样）。
      const useStrict = attempt === 0
      const messages = useStrict
        ? baseMessages
        : injectSchema(baseMessages, schemaText, attempt > 1 ? lastErr : undefined)

      let res: Response
      try {
        res = await this.rawChat(
          {
            model: opts.model ?? this.cfg.model,
            messages,
            response_format: useStrict
              ? { type: 'json_schema', json_schema: { name: 'result', schema: jsonSchema, strict: true } }
              : { type: 'json_object' },
            ...this.thinkingBody(opts),
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          },
          opts.timeoutMs,
        )
      } catch (err) {
        // 超时不降级：换 response_format 无济于事，直接上抛（让调用方按 timeout 处理，如过滤的 fail-open）。
        if (err instanceof LlmError && err.kind === 'timeout') throw err
        // 供应商不支持 json_schema → 当轮立即降级到 json_object（注入 schema 文本）。
        if (useStrict) {
          res = await this.rawChat(
            {
              model: opts.model ?? this.cfg.model,
              messages: injectSchema(baseMessages, schemaText),
              response_format: { type: 'json_object' },
              ...this.thinkingBody(opts),
              ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            },
            opts.timeoutMs,
          )
        } else {
          throw err
        }
      }

      const json = (await res.json()) as ChatCompletion
      const raw = json.choices[0]?.message?.content ?? ''
      const parsed = safeJsonParse(raw)
      if (parsed.ok) {
        const result = schema.safeParse(parsed.value)
        if (result.success) {
          emitStat(opts, startedAt, json.usage)
          return result.data
        }
        lastErr = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      } else {
        lastErr = '非合法 JSON'
      }
    }
    throw new LlmError(`结构化输出校验失败（已重试 ${maxRepair} 次）：${lastErr}`, 'validation')
  }

  async *generateStream(opts: GenerateOptions): AsyncIterable<AgentChunk> {
    const res = await this.rawChat(
      {
        model: this.cfg.model,
        messages: toApiMessages(opts.messages),
        tools: opts.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: 'auto',
        stream: true,
        // 流末附带 token 用量（OpenAI 形状：最后一个 choices=[] 的 chunk 带 usage）。供应商不支持则静默无此 chunk。
        stream_options: { include_usage: true },
        ...this.thinkingBody(opts),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      },
      opts.timeoutMs,
    )
    if (!res.body) throw new LlmError('流式响应无 body', 'provider')
    yield* wrapAbort(parseToolStream(res.body), opts.timeoutMs)
  }
}

// ---- OpenAI 形状的请求/响应辅助：基类专用，对子类不可见 ----

/**
 * 单次 HTTP 调用默认超时（ms）。对齐 run wall-clock 熔断（120s）——单次 LLM 调用本就不该超过整个 run 预算；
 * 主要兜底"provider 无响应/中途 stall 导致请求永久挂起"。需要更紧的调用方（如并发的 RAG 过滤）自带更短 timeoutMs。
 */
const DEFAULT_CALL_TIMEOUT_MS = 120_000

/** AbortSignal.timeout 触发时，把 abort/timeout 异常归一成 LlmError(kind='timeout')；其余原样上抛。 */
function asTimeoutOrRethrow(err: unknown, ms: number): unknown {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new LlmError(`provider 调用超时（${ms}ms 无响应）`, 'timeout', err)
  }
  return err
}

/** 包裹流式生成器：把 body 读取过程中的 abort/timeout 归一成 LlmError(kind='timeout')。 */
async function* wrapAbort<T>(it: AsyncIterable<T>, timeoutMs?: number): AsyncIterable<T> {
  const ms = timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  try {
    yield* it
  } catch (err) {
    throw asTimeoutOrRethrow(err, ms)
  }
}

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
  usage?: ApiUsage
}

/**
 * OpenAI 形状的 usage（snake_case，字段可缺）。除基础三项外含两类缓存命中字段：
 * DeepSeek 的 prompt_cache_hit_tokens / OpenAI·SiliconFlow 的 prompt_tokens_details.cached_tokens。
 */
interface ApiUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
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
  // 流末 usage（include_usage 开时由最后一个 choices=[] 的 chunk 携带；供应商不支持则保持 undefined）。
  let usage: LlmUsage | undefined
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
          usage?: ApiUsage
        }
        if (json.usage) usage = toLlmUsage(json.usage)
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
  if (usage) yield { type: 'usage', usage }
}

/**
 * OpenAI 形状 usage（snake_case，字段可缺）→ 归一化 LlmUsage；缺失计 0，total 缺则由分项相加。
 * 缓存命中数优先读 DeepSeek 的 prompt_cache_hit_tokens，回退 OpenAI 的 prompt_tokens_details.cached_tokens；
 * 两者都缺则不带 cachedPromptTokens（区分「未命中=0」与「供应商不回报」）。
 */
function toLlmUsage(u: ApiUsage): LlmUsage {
  const promptTokens = u.prompt_tokens ?? 0
  const completionTokens = u.completion_tokens ?? 0
  const cachedPromptTokens = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens
  return {
    promptTokens,
    completionTokens,
    totalTokens: u.total_tokens ?? promptTokens + completionTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
  }
}

/** 非流式调用成功时，向 opts.onStat 回报本次耗时 + token 用量（无回调则零开销）。 */
function emitStat(
  opts: { onStat?: (stat: LlmCallStat) => void },
  startedAt: number,
  usage: ApiUsage | undefined,
): void {
  if (!opts.onStat) return
  opts.onStat({ durationMs: Date.now() - startedAt, ...(usage ? { usage: toLlmUsage(usage) } : {}) })
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
