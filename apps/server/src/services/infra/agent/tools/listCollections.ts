import { z } from 'zod'
import type { CollectionService } from '../../../domain/collection.service.js'
import type { Tool, ToolResult } from '../types.js'

const paramsSchema = z.object({})

/**
 * 列出请求者可访问的全部知识库（id + 名称 + 简介）。
 * 模型据此选定一个库的 id，再以该 id 调 knowledge_search 检索。
 * 作用域双重受限：只返回 ctx.principal 有权访问的库，且若本 run 的天花板被收窄为库集
 * （数组 ceiling，经委派），再过滤到该集合——否则会泄露天花板外库的存在。
 */
export function createListCollectionsTool(collectionService: CollectionService): Tool {
  return {
    name: 'list_collections',
    description:
      '列出你可访问的全部知识库及其 id。需要依据知识库内容回答、但尚不确定该查哪个库时调用；拿到 id 后再用 knowledge_search(collectionId) 检索对应库。',
    paramsSchema,
    handler: async (_args, ctx): Promise<ToolResult> => {
      const all = await collectionService.listAccessible(ctx.principal)
      const { ceiling } = ctx.scope
      const cols = ceiling === 'principal' ? all : all.filter((c) => ceiling.includes(c.id))
      if (cols.length === 0) {
        return {
          ok: true,
          output: '（你当前没有任何可访问的知识库）',
          summary: 'list_collections：0 个库',
        }
      }
      const output = cols
        .map((c) => `- ${c.id} :: ${c.name}${c.description ? `（${c.description}）` : ''}`)
        .join('\n')
      return {
        ok: true,
        output: `可访问的知识库（共 ${cols.length} 个）：\n${output}`,
        summary: `list_collections：${cols.length} 个库`,
      }
    },
  }
}
