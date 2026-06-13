import type { MainReasoningTier, RawContextStreamEvent } from '@jnowledge/shared'
import { streamSSE } from './sse'

/** 主推理选项（仅作用于顶层推理）。 */
export interface AskOptions {
  tier?: MainReasoningTier
  thinking?: boolean
}

export const agentApi = {
  /**
   * Agent 提问（SSE 流式，DESIGN §8.9）。下发原始上下文事件流（run/item/patch/error），
   * 前端按到达序累积 raw、跑共享投影派生视图。流结束 resolve，可用 AbortSignal 中断。
   */
  async ask(
    conversationId: string,
    question: string,
    onEvent: (ev: RawContextStreamEvent) => void,
    options?: AskOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    await streamSSE<RawContextStreamEvent>(
      `/conversations/${conversationId}/agent`,
      { question, ...options },
      onEvent,
      signal,
    )
  },
}
