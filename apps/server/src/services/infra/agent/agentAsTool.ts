import { z } from 'zod'
import { uuidv7 } from 'uuidv7'
import type { AgentRunRepo } from '../../../models/agentRun.repo.js'
import type { ContextItemRepo } from '../../../models/contextItem.repo.js'
import { Agent } from './agent.js'
import { createRunRecorder } from './runRecorder.js'
import { narrow } from './scope.js'
import { type AgentDef, type RunContext, type Tool, type ToolResult, MAX_AGENT_DEPTH } from './types.js'

const paramsSchema = z.object({
  task: z.string().min(1).describe('交给子 agent 完成的子任务描述（自包含、明确）'),
  scope: z
    .array(z.string())
    .optional()
    .describe(
      '委派给子 agent 的知识库 id 集合：子 agent 只能在此范围内活动（仅能收窄到你自己可触达的库，超出的会被丢弃）；省略则继承你当前的作用域',
    ),
})

/** agentAsTool 的落库依赖（与 createMutationTools 同构，由组合根/agent.service 接线）。 */
export interface AgentAsToolDeps {
  contextItems: ContextItemRepo
  agentRuns: AgentRunRepo
}

/**
 * 把一个子 agent 包装成工具（agent-as-tool）：对调用方而言与普通工具无法区分。
 * 子 run 在 depth+1、独立上下文运行（消息隔离：只拿到 task，不见父 run 历史）。
 * 深度超 MAX_AGENT_DEPTH 即拒绝，配合 grant 图保持 DAG 防无限递归。
 *
 * 嵌套推理留痕（DESIGN §8.4 run 树）：子 run 分配**独立 runId**（不再复用父）、
 * agent_runs 记 parent_run_id，全过程按 context_items **第三状态（internal）**落库——
 * 既留痕于 raw 视图与 run 树，又不污染 LLM/用户视图。
 *
 * 本期留作扩展点：尚未注册第二个 agent，组合根暂不接线（机制完整但 dormant）。
 *
 * `tools`=子 agent 被授予的工具子集（组合根经 ToolRegistry.select(def.toolNames) 解析后传入）——
 * 构造期注入，与顶层 agent 同构（见 Agent/AgentConfig）。
 */
export function agentAsTool(def: AgentDef, tools: Tool[], deps: AgentAsToolDeps): Tool {
  const { contextItems, agentRuns } = deps
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
      const { task, scope: requestedScope } = args as z.infer<typeof paramsSchema>
      // 子 run：独立 runId + 记 parent_run_id（接入 run 树）；不复用父 runId。
      const childRunId = uuidv7()
      await agentRuns.insert({
        id: childRunId,
        conversationId: ctx.conversationId,
        parentRunId: ctx.runId,
        agentName: def.name,
        input: task,
      })
      // 委派边界：子作用域 = 父 ∩ 请求，只能收窄（不信 LLM 的 scope 参数——交集挡住任何加宽）。
      const childCtx: RunContext = {
        ...ctx,
        runId: childRunId,
        depth: ctx.depth + 1,
        scope: narrow(ctx.scope, requestedScope),
      }
      // 子 run 全过程按第三状态（internal）落库：留痕但不进 LLM/用户视图。
      const recorder = createRunRecorder(contextItems, {
        conversationId: ctx.conversationId,
        runId: childRunId,
        state: 'internal',
      })
      // 子 run 消息隔离：history 仅本轮 task（不见父 run 历史，避免污染跨轮记忆）；
      // system 前缀由 Agent 构造期前置，等价于 [system, task]。
      const childAgent = new Agent({
        name: def.name,
        description: def.description,
        tier: def.tier,
        ...(def.maxSteps !== undefined ? { maxSteps: def.maxSteps } : {}),
        system: def.system,
        tools,
        history: [{ role: 'user', content: task }],
      })
      let answer = ''
      try {
        for await (const ev of childAgent.run(childCtx)) {
          switch (ev.type) {
            case 'assistant':
              await recorder.assistant(ev)
              break
            case 'reasoning':
              recorder.addReasoning(ev.delta)
              break
            case 'text':
              answer += ev.delta
              break
            case 'step_start':
              recorder.noteInput(ev.seq, ev.input)
              break
            case 'tool_result':
              await recorder.toolResult(ev)
              break
            case 'final':
              answer = ev.answer || answer
              break
            case 'error': {
              await agentRuns.fail(childRunId, ev.message)
              return {
                ok: false,
                output: ev.message,
                summary: `${def.name}：${ev.message}`,
                error: ev.message,
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '子 agent 运行失败'
        await agentRuns.fail(childRunId, msg).catch(() => {})
        return { ok: false, output: msg, summary: `${def.name}：${msg}`, error: msg }
      }
      const finalItem = await recorder.finalAssistant(answer, [])
      await agentRuns.complete(childRunId, finalItem.id)
      return { ok: true, output: answer, summary: `${def.name} 完成` }
    },
  }
}
