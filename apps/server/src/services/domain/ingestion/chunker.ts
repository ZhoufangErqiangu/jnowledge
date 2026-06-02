import { countTokens } from './tokenizer.js'

export interface ChunkParams {
  /** 目标 token 数 */
  targetTokens: number
  /** 下限：更小的碎片向上合并 */
  minTokens: number
  /** 硬上限 */
  maxTokens: number
  /** 重叠比例（仅在句边界重叠） */
  overlapRatio: number
}

export const DEFAULT_CHUNK_PARAMS: ChunkParams = {
  targetTokens: 512,
  minTokens: 100,
  maxTokens: 1024,
  overlapRatio: 0.12,
}

export interface ChunkPiece {
  content: string
  /** 原文绝对字符偏移（溯源高亮用） */
  charStart: number
  charEnd: number
  tokenCount: number
  headingPath: string[]
}

/** 原文上的一个区间。所有切分都在区间上做，绝不丢失偏移。 */
interface Span {
  start: number
  end: number
}

/** 段落级片段：一段连续正文 + 其所属标题路径。 */
interface Segment extends Span {
  headingPath: string[]
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/

/**
 * 递归切分主入口。流程：
 * ① 按 Markdown 标题分段并记录 heading_path（章节边界优先，保住整节）。
 * ② 段内按分隔符层级递归切到 token 预算内。
 * ③ 贪心合并过小片段；句边界做 overlap。
 */
export function chunkMarkdown(content: string, params: ChunkParams = DEFAULT_CHUNK_PARAMS): ChunkPiece[] {
  const segments = segmentByHeadings(content)
  const pieces: ChunkPiece[] = []

  for (const seg of segments) {
    const atoms = splitSpan(content, seg, params)
    const merged = mergeAndOverlap(content, atoms, seg.headingPath, params)
    pieces.push(...merged)
  }

  return pieces
}

/** ① 按标题分段，维护标题栈得到每段的 heading_path。标题行本身不计入正文。 */
function segmentByHeadings(content: string): Segment[] {
  const segments: Segment[] = []
  const stack: { level: number; title: string }[] = []
  let offset = 0
  let bodyStart = -1

  const lines = content.split('\n')

  const flush = (bodyEnd: number) => {
    if (bodyStart >= 0 && bodyEnd > bodyStart) {
      const text = content.slice(bodyStart, bodyEnd)
      if (text.trim().length > 0) {
        segments.push({
          start: bodyStart,
          end: bodyEnd,
          headingPath: stack.map((s) => s.title),
        })
      }
    }
    bodyStart = -1
  }

  for (const line of lines) {
    const lineStart = offset
    const lineEnd = offset + line.length
    const m = HEADING_RE.exec(line)
    if (m) {
      flush(lineStart > 0 ? lineStart - 1 : lineStart) // 收掉标题前的正文（不含换行）
      const level = m[1]!.length
      const title = m[2]!.trim()
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
      stack.push({ level, title })
    } else if (bodyStart < 0 && line.trim().length > 0) {
      bodyStart = lineStart
    }
    offset = lineEnd + 1 // +1 跨过 '\n'
  }
  flush(content.length)

  // 全文无标题时，segmentByHeadings 至少给出一段
  if (segments.length === 0 && content.trim().length > 0) {
    segments.push({ start: 0, end: content.length, headingPath: [] })
  }
  return segments
}

/** 分隔符层级（高→低）。每个分隔符给出在区间内的切点（切点为分隔符之后的位置，保留分隔符）。 */
const SEPARATORS: ((text: string) => number[])[] = [
  (t) => allIndexAfter(t, /\n\n/g), // 段落
  (t) => allIndexAfter(t, /\n/g), // 行
  (t) => allIndexAfter(t, /[。！？.!?]/g), // 句末
  (t) => allIndexAfter(t, /[；，;,]/g), // 分句
  (t) => allIndexAfter(t, / /g), // 空格
]

function allIndexAfter(text: string, re: RegExp): number[] {
  const out: number[] = []
  for (const m of text.matchAll(re)) {
    const pos = m.index + m[0].length
    if (pos > 0 && pos < text.length) out.push(pos)
  }
  return out
}

/** ② 段内递归切分到 maxTokens 内，尽量在自然边界断开。 */
function splitSpan(content: string, span: Span, params: ChunkParams, sepIndex = 0): Span[] {
  const text = content.slice(span.start, span.end)
  if (countTokens(text) <= params.targetTokens) return [span]

  // 找一个能把区间切成多片的分隔符层级
  for (let i = sepIndex; i < SEPARATORS.length; i++) {
    const cuts = SEPARATORS[i]!(text)
    if (cuts.length === 0) continue
    const subSpans = splitAtCuts(span, cuts)
    // 对仍超标的子区间继续往更低层级递归
    const out: Span[] = []
    for (const sub of subSpans) {
      const subText = content.slice(sub.start, sub.end)
      if (countTokens(subText) > params.maxTokens) {
        out.push(...splitSpan(content, sub, params, i + 1))
      } else {
        out.push(sub)
      }
    }
    return out
  }

  // 所有分隔符都用尽仍超 maxTokens → 按字符硬切（兜底）
  return hardSplit(content, span, params)
}

function splitAtCuts(span: Span, cuts: number[]): Span[] {
  const spans: Span[] = []
  let prev = 0
  for (const cut of cuts) {
    spans.push({ start: span.start + prev, end: span.start + cut })
    prev = cut
  }
  spans.push({ start: span.start + prev, end: span.end })
  return spans.filter((s) => s.end > s.start)
}

/** 字符级硬切兜底（按 token 预算估算字符窗口）。 */
function hardSplit(content: string, span: Span, params: ChunkParams): Span[] {
  const text = content.slice(span.start, span.end)
  const tokens = countTokens(text)
  const approxCharsPerChunk = Math.max(1, Math.floor((text.length * params.targetTokens) / Math.max(tokens, 1)))
  const out: Span[] = []
  for (let p = 0; p < text.length; p += approxCharsPerChunk) {
    out.push({ start: span.start + p, end: span.start + Math.min(p + approxCharsPerChunk, text.length) })
  }
  return out
}

/** ③ 贪心合并 + 句边界 overlap。 */
function mergeAndOverlap(
  content: string,
  atoms: Span[],
  headingPath: string[],
  params: ChunkParams,
): ChunkPiece[] {
  // 合并：累积 atom 直到接近 target；过小的与下一个并。
  const merged: Span[] = []
  let cur: Span | null = null
  for (const atom of atoms) {
    if (!cur) {
      cur = { ...atom }
      continue
    }
    const combinedTokens = countTokens(content.slice(cur.start, atom.end))
    if (combinedTokens <= params.targetTokens) {
      cur.end = atom.end
    } else {
      merged.push(cur)
      cur = { ...atom }
    }
  }
  if (cur) merged.push(cur)

  // 再做一次 min 合并：若某块仍小于 min，且能与前块并到 <= maxTokens，则并入。
  const compacted: Span[] = []
  for (const block of merged) {
    const prev = compacted[compacted.length - 1]
    if (
      prev &&
      countTokens(content.slice(block.start, block.end)) < params.minTokens &&
      countTokens(content.slice(prev.start, block.end)) <= params.maxTokens
    ) {
      prev.end = block.end
    } else {
      compacted.push({ ...block })
    }
  }

  // overlap：每块（除首块）向前借上一块末尾、在句边界对齐的若干 token。
  const overlapTokens = Math.round(params.targetTokens * params.overlapRatio)
  return compacted.map((block, idx) => {
    let start = block.start
    if (idx > 0 && overlapTokens > 0) {
      start = sentenceAlignedOverlapStart(content, compacted[idx - 1]!, block.start, overlapTokens)
    }
    const text = content.slice(start, block.end)
    return {
      content: text,
      charStart: start,
      charEnd: block.end,
      tokenCount: countTokens(text),
      headingPath,
    }
  })
}

/** 在前一块范围内，往回找一个句边界，使借来的尾巴约等于 overlapTokens。 */
function sentenceAlignedOverlapStart(
  content: string,
  prevBlock: Span,
  blockStart: number,
  overlapTokens: number,
): number {
  const region = content.slice(prevBlock.start, blockStart)
  // 句边界位置（相对 region）
  const boundaries = allIndexAfter(region, /[。！？.!?\n]/g)
  for (let i = boundaries.length - 1; i >= 0; i--) {
    const candidate = prevBlock.start + boundaries[i]!
    if (countTokens(content.slice(candidate, blockStart)) >= overlapTokens) {
      return candidate
    }
  }
  // 没有合适句边界则不重叠
  return blockStart
}
