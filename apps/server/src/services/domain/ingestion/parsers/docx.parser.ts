import mammoth from 'mammoth'
import { normalizeMarkdown, type Parser } from './types.js'
import { htmlToMarkdown } from './htmlToMarkdown.js'

/**
 * Word(.docx) 解析器。mammoth 先抽成 HTML（保住标题/列表/表格语义），
 * 再经统一 HTML→Markdown，从而 heading_path 能填满。
 */
export const docxParser: Parser = {
  name: 'docx',
  async parse({ buffer }) {
    const { value: html } = await mammoth.convertToHtml({ buffer })
    return { markdown: normalizeMarkdown(htmlToMarkdown(html)) }
  },
}
