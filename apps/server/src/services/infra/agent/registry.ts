import { z } from 'zod'
import type { ToolSpec } from '../llm/types.js'
import type { Tool, ToolRegistry } from './types.js'

/**
 * 唯一工具注册表：组合根用显式数组构建（禁动态扫描，遵循全仓「显式注册」约定）。
 * agent 不共享别家工具箱，只通过 specsFor(被授予的名单) 看到子集。
 */
export function createToolRegistry(tools: Tool[]): ToolRegistry {
  const byName = new Map(tools.map((t) => [t.name, t]))
  return {
    get(name) {
      return byName.get(name)
    },
    specsFor(names) {
      const specs: ToolSpec[] = []
      for (const name of names) {
        const t = byName.get(name)
        if (!t) continue
        specs.push({
          name: t.name,
          description: t.description,
          parameters: z.toJSONSchema(t.paramsSchema, { target: 'draft-7' }),
        })
      }
      return specs
    },
  }
}
