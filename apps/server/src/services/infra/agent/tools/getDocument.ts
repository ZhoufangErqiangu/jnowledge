import { z } from 'zod'
import type { Models } from '../../../../models/index.js'
import type { CollectionService } from '../../../domain/collection.service.js'
import type { Tool, ToolResult } from '../types.js'

const paramsSchema = z.object({
  documentId: z.string().describe('文档 id（通常来自 knowledge_search 命中的引用）'),
})

/**
 * primitive 工具示例：按 id 取文档标题与正文摘要。
 * 作用域：知识库会话只能读 ctx.collectionId 下的文档；
 * 全局会话不绑库，改按 ctx.principal 校验该文档所属库的 viewer 权限（最小权限）。
 */
export function createGetDocumentTool(models: Models, collectionService: CollectionService): Tool {
  return {
    name: 'get_document',
    description:
      '按文档 id 获取该文档的标题与正文摘要。当检索到的片段不足、需要查看某文档更多上下文时调用。',
    paramsSchema,
    handler: async (args, ctx): Promise<ToolResult> => {
      const { documentId } = args as z.infer<typeof paramsSchema>
      const doc = await models.documents.findById(documentId)
      const notFound: ToolResult = {
        ok: false,
        output: '文档不存在或无权访问',
        summary: `get_document(${documentId})：未找到`,
        error: 'not found',
      }
      if (!doc) return notFound
      if (ctx.collectionId) {
        // 知识库会话：限定本库。
        if (doc.collection_id !== ctx.collectionId) return notFound
      } else {
        // 全局会话：按用户权限放行其可访问库内的文档。
        try {
          await collectionService.assertRole(ctx.principal, doc.collection_id, 'viewer')
        } catch {
          return notFound
        }
      }
      const version = doc.current_version_id
        ? await models.documentVersions.findById(doc.current_version_id)
        : undefined
      const content = version?.content ?? ''
      const excerpt = content.length > 2000 ? `${content.slice(0, 2000)}…` : content
      return {
        ok: true,
        output: `《${doc.title}》\n\n${excerpt}`,
        summary: `get_document：《${doc.title}》（${content.length} 字）`,
      }
    },
  }
}
