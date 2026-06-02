import pdfParse from 'pdf-parse'
import { normalizeMarkdown, type Parser } from './types.js'

/**
 * PDF 解析器。pdf-parse 抽取纯文本（PDF 本身无结构语义，heading_path 多为空——
 * 这正是二期「输入分析 agent」兜底脏版面/标题重建的落点）。
 */
export const pdfParser: Parser = {
  name: 'pdf',
  async parse({ buffer }) {
    const { text } = await pdfParse(buffer)
    return { markdown: normalizeMarkdown(text) }
  },
}
