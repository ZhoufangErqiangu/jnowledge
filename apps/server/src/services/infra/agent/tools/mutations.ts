import { z } from 'zod'
import { uuidv7 } from 'uuidv7'
import type { CollectionService } from '../../../domain/collection.service.js'
import type { DocumentService } from '../../../domain/document.service.js'
import type { CollectionRepo } from '../../../../models/collection.repo.js'
import type { ContextItemRepo } from '../../../../models/contextItem.repo.js'
import type { DocumentRepo } from '../../../../models/document.repo.js'
import type { PendingOperationRepo } from '../../../../models/pendingOperation.repo.js'
import type { AuditVerdict, OperationAuditor } from '../operationAuditor.js'
import type { LlmCallStat, RunContext, Tool, ToolResult } from '../types.js'
import { inCeiling } from '../scope.js'

export interface MutationToolDeps {
  documentService: DocumentService
  collectionService: CollectionService
  /** 写操作审计-改写 stage（§14.6）。 */
  auditor: OperationAuditor
  pendingOps: PendingOperationRepo
  /** 审计判决落库（第三状态 internal，stage=safety；DESIGN §8.3 / PLAN §14.3）。 */
  contextItems: ContextItemRepo
  /** 确定性事实采集（子库/文档数）——硬规则与 deep context 用。 */
  collections: CollectionRepo
  documents: DocumentRepo
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
  const { documentService, collectionService, auditor, pendingOps, contextItems, collections, documents } =
    deps

  /**
   * 把审计判决落成 internal 条目：留痕于 raw 视图与 run 树，但不进 LLM/用户视图。
   * 第三状态首个试金石（PLAN §14.3）——堵住"判级结果产生即丢"的可观测性洞。
   * source 区分判决来源：deterministic=确定性硬规则（抗注入），auditor=LLM 软判级。
   */
  async function recordVerdict(
    spec: MutationSpec,
    description: string,
    verdict: AuditVerdict,
    source: 'deterministic' | 'auditor',
    ctx: RunContext,
    extra?: Record<string, unknown>,
    llm?: LlmCallStat,
  ): Promise<void> {
    try {
      await contextItems.insert({
        id: uuidv7(),
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        kind: 'tool_result',
        content: `操作审计[${source}]：${verdict.decision}｜${verdict.reason}（操作：${description}）`,
        flags: { state: 'internal' },
        meta: {
          stage: 'safety',
          name: spec.name,
          input: { toolName: spec.name, description, source, ...extra },
          verdict,
          summary: verdict.reason,
          // 仅 LLM 审计（auditor）有耗时/用量；确定性硬规则（deterministic）无 LLM 调用。
          ...(llm ? { llm } : {}),
        },
      })
    } catch {
      // 落库失败不应阻断写操作主流程（留痕是旁路）。
    }
  }

  /** 解析写操作的目标库：须显式提供 collectionId（顶层 agent 不绑库，无默认）。 */
  function resolveCollection(explicit: unknown): string {
    if (typeof explicit === 'string' && explicit) return explicit
    throw new Error('未指定知识库：请提供 collectionId（可先用 list_collections 获取）')
  }

  const specs: MutationSpec[] = [
    {
      name: 'create_document',
      description: '在知识库中新建一篇文档（manual 来源，正文为 Markdown）。',
      paramsSchema: z.object({
        collectionId: z.string().describe('目标知识库 id（必填，可先用 list_collections 获取）'),
        title: z.string().min(1).describe('文档标题'),
        content: z.string().min(1).describe('文档正文（Markdown）'),
        ...confirmTokenField,
      }),
      describe: (a) => `在知识库 ${resolveCollection(a.collectionId)} 新建文档《${a.title}》`,
      run: async (a, ctx) => {
        const collectionId = resolveCollection(a.collectionId)
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

  const specByName = new Map(specs.map((s) => [s.name, s]))

  /** 去掉 confirmToken，得到写进 pending 快照、并在确认时回放的纯操作参数。 */
  function operationArgs(args: Record<string, unknown>): Record<string, unknown> {
    const { confirmToken: _t, ...rest } = args
    return rest
  }

  /**
   * deep context：采集确定性事实（廉价 DB 查询：子项数 / 可逆性 / 目标紧凑描述）。
   * 不读正文全文（避免重新引入"撑爆上下文"）。失败容忍——返回空对象。
   */
  async function gatherFacts(
    spec: MutationSpec,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      if (spec.name === 'delete_collection' || spec.name === 'rename_collection') {
        const cid = typeof args.collectionId === 'string' ? args.collectionId : undefined
        if (!cid) return {}
        const [childCollections, docCount, col] = await Promise.all([
          collections.countChildren(cid),
          documents.countByCollection(cid),
          collections.findById(cid),
        ])
        return {
          collectionId: cid,
          target: col?.name,
          childCollections,
          documents: docCount,
          reversible: spec.name === 'rename_collection',
        }
      }
      if (
        spec.name === 'delete_document' ||
        spec.name === 'update_document' ||
        spec.name === 'move_document'
      ) {
        const did = typeof args.documentId === 'string' ? args.documentId : undefined
        if (!did) return {}
        const doc = await documents.findById(did)
        return { documentId: did, target: doc?.title, exists: !!doc, reversible: true }
      }
      // create_*：新建，易回退。
      return { reversible: true }
    } catch {
      return {}
    }
  }

  /** 本次写操作触达的知识库 id 集（move 含源库与目标库）——供作用域天花板校验。 */
  async function targetCollections(
    spec: MutationSpec,
    args: Record<string, unknown>,
  ): Promise<string[]> {
    const out: string[] = []
    const push = (v: unknown) => {
      if (typeof v === 'string' && v) out.push(v)
    }
    if (
      spec.name === 'create_document' ||
      spec.name === 'rename_collection' ||
      spec.name === 'delete_collection'
    )
      push(args.collectionId)
    if (spec.name === 'create_collection') push(args.parentId)
    if (spec.name === 'move_document') push(args.targetCollectionId)
    if (
      spec.name === 'update_document' ||
      spec.name === 'delete_document' ||
      spec.name === 'move_document'
    ) {
      const did = typeof args.documentId === 'string' ? args.documentId : undefined
      if (did) {
        const doc = await documents.findById(did)
        if (doc) push(doc.collection_id)
      }
    }
    return out
  }

  /**
   * 确定性硬规则（抗注入的安全边界，不经 LLM）：已知灾难性操作直接 reject。
   * 这是"最硬那道闸"——不交给 LLM 独断（DESIGN §8.5 reject 双来源）。
   */
  function hardReject(spec: MutationSpec, facts: Record<string, unknown>): string | null {
    if (spec.name === 'delete_collection') {
      const children = Number(facts.childCollections ?? 0)
      const docs = Number(facts.documents ?? 0)
      if (children > 0 || docs > 0) {
        return `知识库非空（${children} 个子库、${docs} 篇文档），不允许一键删除。请先清空，或在管理界面手动逐项删除。`
      }
    }
    return null
  }

  /** 有界意图：当前用户轮 ±1（末尾最多 2 条 active user 文本），帮助判官理解用户是否真要这么做。 */
  async function gatherIntent(ctx: RunContext): Promise<string | undefined> {
    try {
      const items = await contextItems.listByConversation(ctx.conversationId)
      const users = items
        .filter((i) => i.kind === 'user' && (i.flags?.state ?? 'active') === 'active')
        .map((i) => i.content)
      const recent = users.slice(-2)
      return recent.length ? recent.join(' / ') : undefined
    } catch {
      return undefined
    }
  }

  /** 原始 → 改写 op 落 internal 留痕（§14.6）。 */
  async function recordRewrite(
    spec: MutationSpec,
    originalArgs: Record<string, unknown>,
    revised: { toolName: string; args: Record<string, unknown> },
    ctx: RunContext,
  ): Promise<void> {
    try {
      await contextItems.insert({
        id: uuidv7(),
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        kind: 'tool_result',
        flags: { state: 'internal' },
        content: `审计改写：${spec.name} → ${revised.toolName}`,
        meta: {
          stage: 'safety',
          name: spec.name,
          input: { original: { toolName: spec.name, args: originalArgs }, revised },
          summary: '审计改写操作',
        },
      })
    } catch {
      // 留痕旁路，失败不阻断。
    }
  }

  /** reject 回执：不建 pending、不提供一键确认，要求用户手动操作。 */
  function rejectResult(description: string, reason: string): ToolResult {
    return {
      ok: false,
      output: [
        `⛔ 该操作被拒绝执行：${description}`,
        `原因：${reason}`,
        '此为高危操作，系统不提供一键确认。请如实告知用户，并建议其到知识库管理界面手动完成（如确有必要）。',
      ].join('\n'),
      summary: `已拒绝：${description}`,
      error: 'rejected',
    }
  }

  /** confirm/改写 回执：建 pending，指示模型待用户跨回合确认后调用 toolName + confirmToken。 */
  function needConfirmResult(
    id: string,
    toolName: string,
    description: string,
    verdict: AuditVerdict,
    rewritten: boolean,
  ): ToolResult {
    return {
      ok: true,
      output: [
        `⚠️ 该操作需用户确认：${description}`,
        `判定理由：${verdict.reason}`,
        rewritten ? `（注意：审计已将操作改写为 ${toolName}，必须如实向用户说明改写内容再请其确认）` : '',
        `请把以上计划如实转述给用户并停下；待用户在新消息中明确同意后，调用工具 ${toolName} 并附带参数 ` +
          `confirmToken="${id}" 执行。未获用户同意不得自行确认。`,
      ]
        .filter(Boolean)
        .join('\n'),
      summary: `需确认：${description}`,
    }
  }

  /** 带 token 的确认路径：校验合法提案 + 防同 run 自确认 + 回放快照执行（不二次送审）。 */
  async function confirmAndExecute(
    spec: MutationSpec,
    token: string,
    ctx: RunContext,
  ): Promise<ToolResult> {
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

  /**
   * 审计-改写门（§14.6）：是所有写工具的统一闸口。
   * 确认路径（带 token）直接回放执行、不二次送审；首次提案走
   * 确定性硬规则（抗注入）→ deep context 喂料 → LLM 审计 → allow/confirm/reject/改写 分流。
   */
  async function gate(spec: MutationSpec, args: Record<string, unknown>, ctx: RunContext) {
    let description: string
    try {
      description = spec.describe(args, ctx)
    } catch (err) {
      return toolError(spec.name, err)
    }

    // 确认路径：带 token 不再送审（含改写后的 op），直接校验 + 回放执行。
    const token = typeof args.confirmToken === 'string' ? args.confirmToken : undefined
    if (token) return confirmAndExecute(spec, token, ctx)

    // 作用域天花板（确定性硬边界，仅数组收窄时校验；顶层 principal 恒过、零成本）。
    if (ctx.scope.ceiling !== 'principal') {
      const targets = await targetCollections(spec, args)
      const outside = targets.find((c) => !inCeiling(ctx.scope, c))
      if (outside) {
        const reason = `目标知识库 ${outside} 超出当前委派作用域，无法操作。`
        await recordVerdict(spec, description, { decision: 'reject', reason }, 'deterministic', ctx)
        return rejectResult(description, reason)
      }
    }

    // 首次提案：采集确定性事实 → 硬规则（抗注入）→ LLM 审计 → 分流。
    const facts = await gatherFacts(spec, args)
    const hard = hardReject(spec, facts)
    if (hard) {
      await recordVerdict(spec, description, { decision: 'reject', reason: hard }, 'deterministic', ctx, {
        facts,
      })
      return rejectResult(description, hard)
    }

    const intent = await gatherIntent(ctx)
    const { verdict, llm } = await auditor.audit({ toolName: spec.name, description, facts, intent })
    await recordVerdict(spec, description, verdict, 'auditor', ctx, { facts }, llm)

    if (verdict.decision === 'reject') return rejectResult(description, verdict.reason)

    // 改写校验：revised 须指向已知工具且参数合法，否则丢弃改写、按原 op 处理（安全兜底）。
    let finalSpec = spec
    let finalArgs = operationArgs(args)
    let rewritten = false
    if (verdict.revised) {
      const target = specByName.get(verdict.revised.toolName)
      const parsed = target?.paramsSchema.safeParse(verdict.revised.args)
      if (target && parsed?.success) {
        finalSpec = target
        finalArgs = operationArgs(verdict.revised.args)
        rewritten = true
        await recordRewrite(spec, operationArgs(args), verdict.revised, ctx)
      }
    }

    // allow 且未改写 → 直接执行；confirm 或 改写 → 两阶段确认（改写不二次送审）。
    if (verdict.decision === 'allow' && !rewritten) {
      return execute(finalSpec, finalArgs, ctx, description)
    }

    let finalDescription = description
    if (rewritten) {
      try {
        finalDescription = finalSpec.describe(finalArgs, ctx)
      } catch {
        finalDescription = `${finalSpec.name}（审计改写）`
      }
    }
    const id = uuidv7()
    await pendingOps.insert({
      id,
      conversationId: ctx.conversationId,
      proposingRunId: ctx.runId,
      toolName: finalSpec.name,
      args: finalArgs,
      description: finalDescription,
      riskReason: verdict.reason,
    })
    return needConfirmResult(id, finalSpec.name, finalDescription, verdict, rewritten)
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
