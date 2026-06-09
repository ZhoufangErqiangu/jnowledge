import { z } from 'zod'
import type { AgentRunRepo } from '../../../../models/agentRun.repo.js'
import type { ContextItemRepo } from '../../../../models/contextItem.repo.js'
import type { AgentDef, Tool } from '../../../infra/agent/index.js'
import type { RecordedAgentDeps } from './recordedAgent.js'
import { SubAgent, buildSubAgentTool } from './subAgent.js'

const ragParamsSchema = z.object({
  query: z.string().min(1).describe('要在知识库中检索的查询（自然语言，自包含、尽量具体完整）'),
})

/**
 * 负责 rag 搜索的 agent：一个**检索专用**的子 agent（被当作 tool 调用）。
 * 仅授予检索三件套（list_collections / knowledge_search / get_document），人设聚焦「找全、找准、带出处」，
 * 把多步检索编排封在子 run 内，对父 agent 暴露成单个 `rag_search(query)` 工具。
 *
 * 本期**只定义、不接线**：顶层 assistant 仍直接持有 knowledge_search（拓扑不变）。
 * 接线时只需把 `RagSearchAgent.tool(deps)` 加入工具注册表并授予顶层（届时检索经子 run、引用经共享聚合器上浮）。
 */
export class RagSearchAgent extends SubAgent {
  static readonly persona: AgentDef = {
    name: 'rag_search',
    description: '在知识库中检索并归纳与查询相关的资料要点（每条带 [序号] 出处）',
    system: [
      '你是知识库检索助手。目标：针对给定查询，从知识库中找全找准相关资料，并归纳成带出处的要点。',
      '- 先调用 list_collections 查看可访问的知识库及其 id；再选最相关的库，以其 id 调用 knowledge_search(query, collectionId) 检索；必要时对多个库分别检索、或换措辞补检。',
      '- 命中不足以判断时，可用 get_document 查看某文档更多上下文。',
      '- 输出：归纳相关要点，凡引用了检索资料的句子必须在句末用对应 [序号] 标注出处；若确无相关资料，如实说明「未检索到相关资料」，不要臆测。',
      '- 用简洁的中文输出。',
    ].join('\n'),
    tier: 'standard',
    toolNames: ['list_collections', 'knowledge_search', 'get_document'],
    maxSteps: 6,
  }

  constructor(opts: { tools: Tool[]; query: string }, deps: RecordedAgentDeps) {
    const { persona } = RagSearchAgent
    super(
      {
        name: persona.name,
        description: persona.description,
        tier: persona.tier,
        ...(persona.maxSteps !== undefined ? { maxSteps: persona.maxSteps } : {}),
        system: persona.system,
        tools: opts.tools,
        history: [{ role: 'user', content: opts.query }],
      },
      deps,
    )
  }

  /** 把本人设暴露成 `rag_search(query)` 工具（每次调用构造一个隔离子 agent）。 */
  static tool(deps: { tools: Tool[]; contextItems: ContextItemRepo; agentRuns: AgentRunRepo }): Tool {
    const { persona } = RagSearchAgent
    return buildSubAgentTool(
      {
        name: persona.name,
        description: persona.description,
        tier: persona.tier,
        paramsSchema: ragParamsSchema,
        make: (args) => {
          const { query } = ragParamsSchema.parse(args)
          return {
            agent: new RagSearchAgent(
              { tools: deps.tools, query },
              { contextItems: deps.contextItems, agentRuns: deps.agentRuns },
            ),
            task: query,
          }
        },
      },
      { agentRuns: deps.agentRuns },
    )
  }
}
