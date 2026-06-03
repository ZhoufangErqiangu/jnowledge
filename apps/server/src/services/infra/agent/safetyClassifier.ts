import { z } from 'zod'
import type { LLMClient } from '../llm/types.js'

/** 待判定的写操作描述。 */
export interface OperationSpec {
  /** 工具名，如 delete_document。 */
  toolName: string
  /** 人类可读的操作描述（含目标对象/范围），喂给分类器判级。 */
  description: string
}

export interface SafetyVerdict {
  risk: 'low' | 'high'
  reason: string
}

export interface SafetyClassifier {
  /** 判定写操作风险。失败/未配置一律按 high（宁可多一次确认）。 */
  classify(op: OperationSpec): Promise<SafetyVerdict>
}

const verdictSchema = z.object({
  risk: z.enum(['low', 'high']).describe('风险等级：low=安全可直接执行；high=需用户确认'),
  reason: z.string().describe('一句话中文说明判定理由'),
})

const SYSTEM = [
  '你是知识库写操作的安全审查员。给定一个即将执行的增删改操作，判定其风险等级。',
  '判定原则：',
  '- high（需用户确认）：任何删除（尤其删除知识库、删除文档）、大范围或批量改动、不可逆的内容整体覆盖。',
  '- low（可直接执行）：新建文档/知识库、小幅修改标题、追加或局部编辑内容等低破坏性操作。',
  '- 拿不准时从严判 high。',
  '只输出判定结果，不要执行任何操作，不要多余解释。',
].join('\n')

export function createSafetyClassifier(llm: LLMClient): SafetyClassifier {
  return {
    async classify(op) {
      if (!llm.configured) {
        return { risk: 'high', reason: '生成模型未配置，无法评估风险，按高风险要求确认' }
      }
      try {
        return await llm.tier('standard').object(verdictSchema, {
          system: SYSTEM,
          prompt: `操作工具：${op.toolName}\n操作描述：${op.description}\n\n请判定风险等级。`,
          temperature: 0,
        })
      } catch {
        return { risk: 'high', reason: '风险评估调用失败，按高风险要求确认' }
      }
    },
  }
}
