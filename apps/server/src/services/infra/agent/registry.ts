import { z } from 'zod'
import type { ToolSpec } from '../llm/types.js'
import type { Tool, ToolRegistry } from './types.js'

/** Tool → 喂给模型的 ToolSpec（zod paramsSchema 转 JSON Schema）。Agent 构造期建 specs 复用。 */
export function toToolSpec(tool: Tool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.paramsSchema, { target: 'draft-7' }),
  }
}

/**
 * 工具目录（catalog）：组合根用显式数组构建（禁动态扫描，遵循全仓「显式注册」约定）。
 * 仅在**构造期**用来按名取被授予子集（select），再注入各 agent——不进 RunContext、不进运行 loop。
 * 「授予非共享」：agent 见到的是 select 出来的 Tool[] 子集，彼此工具箱不共享。
 */
export function createToolRegistry(tools: Tool[]): ToolRegistry {
  const byName = new Map(tools.map((t) => [t.name, t]))
  return {
    get(name) {
      return byName.get(name)
    },
    select(names) {
      const out: Tool[] = []
      for (const name of names) {
        const t = byName.get(name)
        if (t) out.push(t)
      }
      return out
    },
  }
}
