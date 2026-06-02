import TurndownService from 'turndown'

/** 共享的 HTML→Markdown 转换器（HtmlParser 与 DocxParser 都用）。 */
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

// 去掉脚本/样式噪声
turndown.remove(['script', 'style', 'noscript'])

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}
