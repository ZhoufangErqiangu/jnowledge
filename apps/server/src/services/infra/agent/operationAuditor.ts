import { z } from 'zod'
import type { ChatService, LlmCallStat } from '../llm/types.js'

/**
 * 写操作审计-改写 stage（五期 §14.6 / DESIGN §8.5）。
 * 由"纯安全分类器 {risk}"升级为"审计 + 改写"：输出 allow/confirm/reject + 可选改写。
 *
 * 重要：LLM 不是安全边界（抗注入弱）。最硬那道闸是 mutations.ts gate 里的**确定性硬规则**
 * （删非空库等），不交给本 LLM 独断；本审计器只做软判级 + 降级改写建议。
 */
export interface OperationSpec {
  /** 工具名，如 delete_document。 */
  toolName: string
  /** 人类可读的操作描述（含目标对象/范围）。 */
  description: string
  /**
   * 确定性事实（廉价 DB 查询所得：子项数 / 大小 / 可逆性 / 目标紧凑描述）。
   * **不喂正文全文**——避免把要消灭的"撑爆上下文"请回来（DESIGN §8.5 deep context）。
   */
  facts?: Record<string, unknown> | undefined
  /** 有界意图（当前用户轮 ±1），帮助判官理解用户是否真要这么做。 */
  intent?: string | undefined
}

export interface AuditVerdict {
  decision: 'allow' | 'confirm' | 'reject'
  reason: string
  /**
   * 改写：改参数 / 换工具（如把"删整库"降级为"删指定文档"）。非空 → 强制走用户确认、
   * 不二次送审（gate 负责）。改写后的工具/参数。
   */
  revised?: { toolName: string; args: Record<string, unknown> } | undefined
}

/** 审计结果：判决 + 本次 LLM 调用的耗时/用量（未真正调模型时 llm 缺省，如未配置/降级）。 */
export interface AuditResult {
  verdict: AuditVerdict
  llm?: LlmCallStat
}

export interface OperationAuditor {
  /** 审计写操作。失败/未配置 → confirm（不静默放行，也不静默拒绝）。 */
  audit(op: OperationSpec): Promise<AuditResult>
}

const verdictSchema = z.object({
  decision: z
    .enum(['allow', 'confirm', 'reject'])
    .describe(
      'allow=低风险可直接执行；confirm=需用户二次确认后执行；reject=高危不提供一键确认、要求用户手动操作',
    ),
  reason: z.string().describe('一句话中文说明判定理由'),
  revised: z
    .object({
      toolName: z.string().describe('改写后要执行的工具名（可与原工具不同）'),
      args: z.record(z.string(), z.unknown()).describe('改写后的完整工具参数'),
    })
    .optional()
    .describe('若能把操作降级为更安全的等价操作（改参数/换工具）则给出，否则省略'),
})

const SYSTEM = [
  '你是知识库写操作的审计员。给定一个即将执行的增删改操作（含确定性事实与用户近期意图），输出审计决策。',
  '决策档位：',
  '- allow：低风险且明显符合用户意图，可直接执行（如新建文档/知识库、小幅修改标题、局部追加）。',
  '- confirm：有一定影响面或风险，需用户二次确认后执行（如删除单篇文档、移动文档、较大范围改动）。',
  '- reject：高危且不应提供一键确认（如删除非空知识库、大范围不可逆破坏），应要求用户手动操作。',
  '- 若能把危险操作降级为更安全的等价操作（改参数，或换用更精确的工具），在 revised 中给出改写——改写一定会再经用户确认。',
  '判定时参考「操作相关事实」（子项数 / 可逆性等）与「用户近期意图」。拿不准时从严（confirm 优先于 allow）。',
  '只输出判定结果，不要执行任何操作，不要多余解释。',
].join('\n')

export function createOperationAuditor(chat: ChatService): OperationAuditor {
  return {
    async audit(op) {
      if (!chat.configured) {
        return { verdict: { decision: 'confirm', reason: '生成模型未配置，无法评估风险，按需确认' } }
      }
      try {
        const facts = op.facts ? `\n操作相关事实：${JSON.stringify(op.facts)}` : ''
        const intent = op.intent ? `\n用户近期意图：${op.intent}` : ''
        let llm: LlmCallStat | undefined
        const verdict = await chat.tier('nano').object(verdictSchema, {
          system: SYSTEM,
          prompt: `操作工具：${op.toolName}\n操作描述：${op.description}${facts}${intent}\n\n请审计该操作。`,
          temperature: 0,
          onStat: (s) => {
            llm = s
          },
        })
        return { verdict, ...(llm ? { llm } : {}) }
      } catch {
        return { verdict: { decision: 'confirm', reason: '风险评估调用失败，按需确认' } }
      }
    },
  }
}
