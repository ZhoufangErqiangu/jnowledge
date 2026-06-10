import { API_BASE_URL, ApiError, TOKEN_KEY } from './http'

/**
 * 通用 SSE POST 读流：用 fetch 增量读取（axios 不便于流式），逐个 `data: <json>` 事件回调 onEvent。
 * 返回的 Promise 在流结束时 resolve；可用 AbortSignal 中断。
 */
export async function streamSSE<T>(
  url: string,
  body: unknown,
  onEvent: (ev: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  if (!res.ok || !res.body) {
    throw new ApiError('NETWORK', '请求失败', res.status)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE 事件以空行分隔。
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const evt of events) {
      const dataLine = evt.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      try {
        onEvent(JSON.parse(dataLine.slice(5).trim()) as T)
      } catch {
        // 忽略不完整/心跳分片
      }
    }
  }
}
