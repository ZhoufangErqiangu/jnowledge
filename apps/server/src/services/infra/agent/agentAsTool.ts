import { z } from 'zod'
import type { AgentTurnMessage } from '../llm/types.js'
import { runAgent } from './runtime.js'
import {
  type AgentDef,
  type RunContext,
  type Tool,
  type ToolResult,
  MAX_AGENT_DEPTH,
} from './types.js'

const paramsSchema = z.object({
  task: z.string().min(1).describe('交给子 agent 完成的子任务描述（自包含、明确）'),
})

/**
 * 把一个子 agent 包装成工具（agent-as-tool）：对调用方而言与普通工具无法区分。
 * 子 run 在 depth+1、独立上下文运行（消息隔离：只拿到 task，不见父 run 历史）。
 * 深度超 MAX_AGENT_DEPTH 即拒绝，配合 grant 图保持 DAG 防无限递归。
 *
 * 本期留作扩展点：尚未注册第二个 agent，组合根暂不接线。
 */
export function agentAsTool(def: AgentDef): Tool {
  return {
    name: def.name,
    description: def.description,
    paramsSchema,
    tier: def.tier,
    handler: async (args, ctx): Promise<ToolResult> => {
      if (ctx.depth >= MAX_AGENT_DEPTH) {
        return {
          ok: false,
          output: '子 agent 调用深度超限',
          summary: `${def.name}：深度熔断`,
          error: 'max agent depth',
        }
      }
      const { task } = args as z.infer<typeof paramsSchema>
      const childCtx: RunContext = { ...ctx, depth: ctx.depth + 1 }
      // 子 run 消息隔离：自拼 [system, task]，不见父 run 历史，也不落 context_items（避免污染用户视图/跨轮记忆）。
      const childMessages: AgentTurnMessage[] = [
        { role: 'system', content: def.system },
        { role: 'user', content: task },
      ]
      let answer = ''
      for await (const ev of runAgent(def, childMessages, childCtx)) {
        if (ev.type === 'text') answer += ev.delta
        else if (ev.type === 'final') answer = ev.answer
        else if (ev.type === 'error') {
          return {
            ok: false,
            output: ev.message,
            summary: `${def.name}：${ev.message}`,
            error: ev.message,
          }
        }
      }
      return { ok: true, output: answer, summary: `${def.name} 完成` }
    },
  }
}
