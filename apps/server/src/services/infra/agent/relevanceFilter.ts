import { z } from 'zod'
import type { RetrievedChunk } from '../../domain/retrieval.js'
import type { ChatService } from '../llm/types.js'

/**
 * RAG 抽取式相关性过滤（五期 §14.4 / DESIGN §8.1·2）：检索命中后、拼进生成上下文前，
 * 用廉价推理（nano）对每条命中做**保留/丢弃整段**的二分类——不改写正文（保引用 verbatim 溯源）。
 *
 * 定位：reranker（retrieval.ts）之后的语义守门员，专抓"分数高但其实跑题"的命中，非重复打分。
 * 工程取巧：命中数 ≤ skipThreshold 或 chat 未配置 → 直接全量放行（小规模无需过滤，省调用）。
 * fail-open：单条判定出错按保留处理（宁可多留，不误杀召回）。
 */
export interface FilterResult {
  /** 判定保留的命中（保持原顺序与 marker）。 */
  kept: RetrievedChunk[]
  /** 被丢弃的命中（留痕审计用）。 */
  dropped: { marker: number; documentTitle: string; reason: string }[]
  /** 是否触发了过滤（false=命中过少/未配置，直接放行）。 */
  applied: boolean
}

export interface RelevanceFilter {
  filter(query: string, chunks: RetrievedChunk[]): Promise<FilterResult>
}

const decisionSchema = z.object({
  keep: z.boolean().describe('该资料片段是否与问题相关、值得作为回答依据：true=保留，false=丢弃'),
  reason: z.string().describe('一句话中文说明保留/丢弃的理由'),
})

const SYSTEM = [
  '你是 RAG 检索结果的相关性守门员。给定用户的检索查询与一段候选资料，判断这段资料是否真正与查询相关、值得作为回答依据。',
  '判定原则：',
  '- keep=true：资料直接或实质性地涉及查询主题，能支撑回答。',
  '- keep=false：资料与查询主题无关、仅字面撞词、或纯属噪声。',
  '- 拿不准时倾向保留（keep=true），避免误杀有用召回。',
  '只判定这一段，不要受其他资料影响，不要臆造资料中没有的内容。',
].join('\n')

export function createRelevanceFilter(
  chat: ChatService,
  opts: { skipThreshold: number },
): RelevanceFilter {
  return {
    async filter(query, chunks): Promise<FilterResult> {
      // 小规模命中或未配置模型：直接放行（不进过滤 stage）。
      if (!chat.configured || chunks.length <= opts.skipThreshold) {
        return { kept: chunks, dropped: [], applied: false }
      }

      // per-chunk 并行二分类。
      const decisions = await Promise.all(
        chunks.map(async (c) => {
          try {
            const d = await chat.tier('nano').object(decisionSchema, {
              system: SYSTEM,
              prompt: `检索查询：${query}\n\n候选资料《${c.documentTitle}》：\n${c.context}\n\n该资料是否与查询相关？`,
              temperature: 0,
            })
            return d
          } catch {
            // fail-open：判定失败按保留。
            return { keep: true, reason: '相关性判定失败，保留' }
          }
        }),
      )

      const kept: RetrievedChunk[] = []
      const dropped: FilterResult['dropped'] = []
      chunks.forEach((c, i) => {
        const d = decisions[i]!
        if (d.keep) kept.push(c)
        else dropped.push({ marker: c.marker, documentTitle: c.documentTitle, reason: d.reason })
      })
      return { kept, dropped, applied: true }
    },
  }
}
