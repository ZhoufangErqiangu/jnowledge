import type { AgentStreamEvent } from '@jnowledge/shared'
import { streamSSE } from './sse'

export const agentApi = {
  /**
   * Agent 提问（SSE 流式）。与 RAG 的 ask 并存，事件为超集（多 step_start/tool_result 执行轨迹）。
   * 流结束 resolve，可用 AbortSignal 中断。
   */
  async ask(
    conversationId: string,
    question: string,
    onEvent: (ev: AgentStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    await streamSSE<AgentStreamEvent>(
      `/conversations/${conversationId}/agent`,
      { question },
      onEvent,
      signal,
    )
  },
}
