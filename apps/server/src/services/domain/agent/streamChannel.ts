/**
 * 极简异步通道（单生产者 / 单消费者）：把「推」式事件汇（ctx.sink）接成「拉」式 async 迭代，
 * 供 ask() 边驱动 agent 边 yield 事件（DESIGN §8.9）。
 *
 * 为何需要它：工具是 `await handler()`，子 agent 事件全发生在父循环阻塞的那个 await 内部，
 * 没法顺着父生成器的 yield 冒上去。故子 agent（与顶层）经 sink **推**事件到本通道，ask 从通道**拉**，
 * 二者并发——子事件在父 invokeTool 阻塞期间即时流出，而非攒到工具返回后才一次性吐出。
 */
export interface StreamChannel<T> {
  /** 生产者推入一个事件（close 后丢弃）。 */
  push(v: T): void
  /** 正常结束：迭代器随缓冲排空而终止。 */
  close(): void
  /** 异常结束：缓冲排空后向消费者抛出 err。 */
  fail(err: unknown): void
  [Symbol.asyncIterator](): AsyncIterator<T>
}

export function createStreamChannel<T>(): StreamChannel<T> {
  const buffer: T[] = []
  let wake: (() => void) | null = null
  let closed = false
  let failure: { err: unknown } | null = null

  const signal = (): void => {
    if (wake) {
      const w = wake
      wake = null
      w()
    }
  }

  return {
    push(v: T): void {
      if (closed) return
      buffer.push(v)
      signal()
    },
    close(): void {
      closed = true
      signal()
    },
    fail(err: unknown): void {
      failure = { err }
      closed = true
      signal()
    },
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      for (;;) {
        if (buffer.length > 0) {
          yield buffer.shift() as T
          continue
        }
        if (closed) {
          if (failure) throw failure.err
          return
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}
