import { normalizeMarkdown, type Parser } from './types.js'
import { htmlToMarkdown } from './htmlToMarkdown.js'

export const htmlParser: Parser = {
  name: 'html',
  async parse({ buffer }) {
    const md = htmlToMarkdown(buffer.toString('utf8'))
    return { markdown: normalizeMarkdown(md) }
  },
}
