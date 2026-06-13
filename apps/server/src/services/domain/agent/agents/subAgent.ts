import { uuidv7 } from 'uuidv7'
import type { z } from 'zod'
import type { LlmTier } from '@jnowledge/shared'
import type { AgentRunRepo } from '../../../../models/agentRun.repo.js'
import {
  narrow,
  type RunContext,
  type Tool,
  type ToolResult,
  MAX_AGENT_DEPTH,
} from '../../../infra/agent/index.js'
import { RecordedAgent, drain } from './recordedAgent.js'

/**
 * 被当作 tool 调用的 agent（abstract）：角色 = internal 落库（仅留痕，不进 LLM/用户视图）。
 * 子 run 在 depth+1、独立 runId（记 parent_run_id 接入 run 树）、消息隔离（只拿到 task）下运行；
 * 与父**共享 `ctx.citations`** —— marker 自然上浮，日后接线无需额外处理。
 *
 * 具体子 agent（如 {@link RagSearchAgent}）继承本类写人设，并经 {@link buildSubAgentTool} 暴露成工具。
 */
export abstract class SubAgent extends RecordedAgent {
  protected readonly recordState = 'internal' as const

  /**
   * 作为子 run 执行：driveAndRecord（消费事件、不外发）→ 终答落 internal 条目 + complete →
   * 返回 ToolResult。失败即 run=failed 并回报错误（不抛给父循环，让父 agent 自行纠正）。
   */
  async runAsChild(name: string, childCtx: RunContext): Promise<ToolResult> {
    let result
    try {
      result = await drain(this.driveAndRecord(childCtx))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '子 agent 运行失败'
      await this.fail(childCtx, msg)
      return { ok: false, output: msg, summary: `${name}：${msg}`, error: msg }
    }
    await this.complete(childCtx, result.answer, [])
    return { ok: true, output: result.answer, summary: `${name} 完成` }
  }
}

/** buildSubAgentTool 的规格：把某 SubAgent 人设包成工具。 */
export interface SubAgentToolSpec {
  name: string
  description: string
  tier?: LlmTier
  paramsSchema: z.ZodType
  /** 从（已校验的）入参产一个就绪的子 agent（history=[user:task]）+ 子任务文本 + 可选请求作用域。 */
  make(args: unknown): { agent: SubAgent; task: string; requestedScope?: string[] }
}

/**
 * 把某 SubAgent 人设包成工具（取代旧 agentAsTool 函数）：对调用方与普通工具无法区分。
 * 深度超 MAX_AGENT_DEPTH 即拒；委派边界 = 父 ∩ 请求（`narrow` 只收窄，不信 LLM 的 scope 加宽）。
 */
export function buildSubAgentTool(spec: SubAgentToolSpec, deps: { agentRuns: AgentRunRepo }): Tool {
  return {
    name: spec.name,
    description: spec.description,
    paramsSchema: spec.paramsSchema,
    kind: 'agent',
    ...(spec.tier ? { tier: spec.tier } : {}),
    handler: async (args, ctx): Promise<ToolResult> => {
      if (ctx.depth >= MAX_AGENT_DEPTH) {
        return {
          ok: false,
          output: '子 agent 调用深度超限',
          summary: `${spec.name}：深度熔断`,
          error: 'max agent depth',
        }
      }
      const { agent, task, requestedScope } = spec.make(args)
      // 子 run：独立 runId + 记 parent_run_id（接入 run 树）；不复用父 runId。
      const childRunId = uuidv7()
      await deps.agentRuns.insert({
        id: childRunId,
        conversationId: ctx.conversationId,
        parentRunId: ctx.runId,
        agentName: spec.name,
        input: task,
      })
      // 子 run 节点入流（DESIGN §8.9）：前端据 parentRunId 建嵌套、把随后上浮的子 agent
      // item/patch 归到这条参与方泳道。childCtx 经 spread 继承同一 sink → 子事件自然上浮。
      ctx.sink?.({
        type: 'run',
        node: { id: childRunId, parentRunId: ctx.runId, agentName: spec.name, status: 'running' },
      })
      const childCtx: RunContext = {
        ...ctx,
        runId: childRunId,
        depth: ctx.depth + 1,
        scope: narrow(ctx.scope, requestedScope),
      }
      const citationsBefore = ctx.citations.length
      const result = await agent.runAsChild(spec.name, childCtx)
      if (result.ok && typeof result.output === 'string') {
        const newCitations = ctx.citations.slice(citationsBefore)
        if (newCitations.length > 0) {
          const seen = new Set<string>()
          const docs: { id: string; title: string }[] = []
          for (const c of newCitations) {
            if (!seen.has(c.documentId)) {
              seen.add(c.documentId)
              docs.push({ id: c.documentId, title: c.documentTitle })
            }
          }
          const footer = docs.map((d) => `  • 《${d.title}》 document_id: ${d.id}`).join('\n')
          return {
            ...result,
            output: `${result.output}\n\n**涉及文档（document_id 可直接传给 get_document / update_document）**\n${footer}`,
          }
        }
      }
      return result
    },
  }
}
