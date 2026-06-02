import { normalizeMarkdown, type Parser } from './types.js'

/**
 * 纯文本 / Markdown 解析器。
 * 输入已是文本（含本就是 .md 的情况），仅做归一化；保留既有 Markdown 结构。
 */
export const plainTextParser: Parser = {
  name: 'plain-text',
  async parse({ buffer }) {
    return { markdown: normalizeMarkdown(buffer.toString('utf8')) }
  },
}
