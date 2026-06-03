import { z } from 'zod'
import { uuidv7 } from 'uuidv7'
import type { CollectionService } from '../../../domain/collection.service.js'
import type { DocumentService } from '../../../domain/document.service.js'
import type { PendingOperationRepo } from '../../../../models/pendingOperation.repo.js'
import type { SafetyClassifier } from '../safetyClassifier.js'
import type { RunContext, Tool, ToolResult } from '../types.js'

export interface MutationToolDeps {
  documentService: DocumentService
  collectionService: CollectionService
  classifier: SafetyClassifier
  pendingOps: PendingOperationRepo
}

/** 单个写工具的规格：参数 schema + 描述生成 + 实际执行（执行用「最终生效的参数」，确认路径下为 pending 快照）。 */
interface MutationSpec {
  name: string
  description: string
  paramsSchema: z.ZodObject<z.ZodRawShape>
  /** 给安全分类器/用户看的人类描述。 */
  describe: (args: Record<string, unknown>, ctx: RunContext) => string
  /** 真正执行变更，返回成功输出文本。 */
  run: (args: Record<string, unknown>, ctx: RunContext) => Promise<string>
}

const confirmTokenField = {
  confirmToken: z
    .string()
    .optional()
    .describe(
      '确认令牌：仅当某次调用返回「需确认」后、用户在新消息中明确同意，方可带上其给出的令牌重试',
    ),
}

export function createMutationTools(deps: MutationToolDeps): Tool[] {
  const { documentService, collectionService, classifier, pendingOps } = deps

  /** 解析写操作的目标库：显式参数优先，否则用会话绑定库；都没有则报错。 */
  function resolveCollection(explicit: unknown, ctx: RunContext): string {
    const target = (typeof explicit === 'string' && explicit) || ctx.collectionId
    if (!target) throw new Error('未指定知识库：全局会话需显式提供 collectionId')
    return target
  }

  const specs: MutationSpec[] = [
    {
      name: 'create_document',
      description: '在知识库中新建一篇文档（manual 来源，正文为 Markdown）。',
      paramsSchema: z.object({
        collectionId: z.string().optional().describe('目标知识库 id；库内会话可省略（默认当前库）'),
        title: z.string().min(1).describe('文档标题'),
        content: z.string().min(1).describe('文档正文（Markdown）'),
        ...confirmTokenField,
      }),
      describe: (a, ctx) =>
        `在知识库 ${resolveCollection(a.collectionId, ctx)} 新建文档《${a.title}》`,
      run: async (a, ctx) => {
        const collectionId = resolveCollection(a.collectionId, ctx)
        const doc = await documentService.createManual(ctx.principal, {
          collectionId,
          title: a.title as string,
          content: a.content as string,
        })
        return `已创建文档《${doc.title}》（id=${doc.id}），正在后台解析与向量化。`
      },
    },
    {
      name: 'update_document',
      description: '修改一篇已有文档的标题和/或正文（改正文会建新版本并重新向量化）。',
      paramsSchema: z.object({
        documentId: z.string().describe('要修改的文档 id'),
        title: z.string().min(1).optional().describe('新标题（不改则省略）'),
        content: z.string().min(1).optional().describe('新正文 Markdown（不改则省略）'),
        ...confirmTokenField,
      }),
      describe: (a) => {
        const parts = [a.title ? '标题' : '', a.content ? '正文' : ''].filter(Boolean).join('、')
        return `修改文档 ${a.documentId}（${parts || '无字段'}）`
      },
      run: async (a, ctx) => {
        await documentService.update(ctx.principal, a.documentId as string, {
          ...(a.title !== undefined ? { title: a.title as string } : {}),
          ...(a.content !== undefined ? { content: a.content as string } : {}),
        })
        return `已更新文档 ${a.documentId}。`
      },
    },
    {
      name: 'delete_document',
      description: '删除一篇文档（软删除，从检索中移除）。',
      paramsSchema: z.object({
        documentId: z.string().describe('要删除的文档 id'),
        ...confirmTokenField,
      }),
      describe: (a) => `删除文档 ${a.documentId}`,
      run: async (a, ctx) => {
        await documentService.remove(ctx.principal, a.documentId as string)
        return `已删除文档 ${a.documentId}。`
      },
    },
    {
      name: 'move_document',
      description: '把一篇文档移动到另一个知识库。',
      paramsSchema: z.object({
        documentId: z.string().describe('要移动的文档 id'),
        targetCollectionId: z.string().describe('目标知识库 id'),
        ...confirmTokenField,
      }),
      describe: (a) => `把文档 ${a.documentId} 移动到知识库 ${a.targetCollectionId}`,
      run: async (a, ctx) => {
        await documentService.move(
          ctx.principal,
          a.documentId as string,
          a.targetCollectionId as string,
        )
        return `已将文档 ${a.documentId} 移动到知识库 ${a.targetCollectionId}。`
      },
    },
    {
      name: 'create_collection',
      description: '新建一个知识库（可选父库构成层级）。',
      paramsSchema: z.object({
        name: z.string().min(1).describe('知识库名称'),
        parentId: z.string().optional().describe('父知识库 id（建顶层则省略）'),
        description: z.string().optional().describe('知识库简介'),
        ...confirmTokenField,
      }),
      describe: (a) => `新建知识库《${a.name}》`,
      run: async (a, ctx) => {
        const col = await collectionService.create(ctx.principal, {
          name: a.name as string,
          ...(a.parentId !== undefined ? { parentId: a.parentId as string } : {}),
          ...(a.description !== undefined ? { description: a.description as string } : {}),
        })
        return `已创建知识库《${col.name}》（id=${col.id}）。`
      },
    },
    {
      name: 'rename_collection',
      description: '重命名一个知识库。',
      paramsSchema: z.object({
        collectionId: z.string().describe('要重命名的知识库 id'),
        name: z.string().min(1).describe('新名称'),
        ...confirmTokenField,
      }),
      describe: (a) => `重命名知识库 ${a.collectionId} 为《${a.name}》`,
      run: async (a, ctx) => {
        await collectionService.update(ctx.principal, a.collectionId as string, {
          name: a.name as string,
        })
        return `已重命名知识库 ${a.collectionId} 为《${a.name}》。`
      },
    },
    {
      name: 'delete_collection',
      description: '删除一个知识库（连同其下文档一并不可见）。',
      paramsSchema: z.object({
        collectionId: z.string().describe('要删除的知识库 id'),
        ...confirmTokenField,
      }),
      describe: (a) => `删除知识库 ${a.collectionId}`,
      run: async (a, ctx) => {
        await collectionService.remove(ctx.principal, a.collectionId as string)
        return `已删除知识库 ${a.collectionId}。`
      },
    },
  ]

  /** 去掉 confirmToken，得到写进 pending 快照、并在确认时回放的纯操作参数。 */
  function operationArgs(args: Record<string, unknown>): Record<string, unknown> {
    const { confirmToken: _t, ...rest } = args
    return rest
  }

  /** 分类 → 确认门 → 执行。是所有写工具的统一闸口。 */
  async function gate(spec: MutationSpec, args: Record<string, unknown>, ctx: RunContext) {
    let description: string
    try {
      description = spec.describe(args, ctx)
    } catch (err) {
      return toolError(spec.name, err)
    }

    const verdict = await classifier.classify({ toolName: spec.name, description })

    // 低风险：直接执行。
    if (verdict.risk === 'low') {
      return execute(spec, operationArgs(args), ctx, description)
    }

    // 高风险：两阶段确认。
    const token = typeof args.confirmToken === 'string' ? args.confirmToken : undefined
    if (!token) {
      const id = uuidv7()
      await pendingOps.insert({
        id,
        conversationId: ctx.conversationId,
        proposingRunId: ctx.runId,
        toolName: spec.name,
        args: operationArgs(args),
        description,
        riskReason: verdict.reason,
      })
      return {
        ok: true,
        output: [
          `⚠️ 该操作需用户确认：${description}`,
          `风险判定：${verdict.reason}`,
          '请把以上计划如实转述给用户并停下；待用户在新消息中明确同意后，再用相同操作并附带参数 ' +
            `confirmToken="${id}" 重新调用本工具执行。未获用户同意不得自行确认。`,
        ].join('\n'),
        summary: `需确认：${description}`,
      } satisfies ToolResult
    }

    // 带 token：校验是否为「上一回合」提出且未消费的合法提案。
    const pending = await pendingOps.findById(token)
    if (
      !pending ||
      pending.conversation_id !== ctx.conversationId ||
      pending.tool_name !== spec.name ||
      pending.status !== 'pending'
    ) {
      return {
        ok: false,
        output: '确认令牌无效或已失效。',
        summary: '确认失败：令牌无效',
        error: 'invalid token',
      }
    }
    if (pending.proposing_run_id === ctx.runId) {
      // 同一 run 内自填 token —— 不构成跨轮次用户确认，拒绝。
      return {
        ok: false,
        output: '该操作刚提出，尚未获得用户确认，不能在同一回合执行。请等待用户在新消息中同意。',
        summary: '确认失败：需用户跨回合确认',
        error: 'same-run confirm',
      }
    }
    const consumed = await pendingOps.markConfirmed(token)
    if (!consumed) {
      return {
        ok: false,
        output: '该操作已被处理。',
        summary: '确认失败：已处理',
        error: 'already consumed',
      }
    }
    // 回放 pending 快照里的参数（防提案后被篡改），而非本次调用的 args。
    return execute(spec, pending.args, ctx, pending.description)
  }

  async function execute(
    spec: MutationSpec,
    args: Record<string, unknown>,
    ctx: RunContext,
    description: string,
  ): Promise<ToolResult> {
    try {
      const output = await spec.run(args, ctx)
      return { ok: true, output, summary: output }
    } catch (err) {
      return toolError(spec.name, err, description)
    }
  }

  function toolError(name: string, err: unknown, description?: string): ToolResult {
    const msg = err instanceof Error ? err.message : '执行失败'
    return {
      ok: false,
      output: `操作失败：${msg}${description ? `（${description}）` : ''}`,
      summary: `${name} 失败：${msg}`,
      error: msg,
    }
  }

  return specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    paramsSchema: spec.paramsSchema,
    handler: (args, ctx) => gate(spec, args as Record<string, unknown>, ctx),
  }))
}
