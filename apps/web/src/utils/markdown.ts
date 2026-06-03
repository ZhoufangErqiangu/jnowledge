import MarkdownIt from 'markdown-it'

/**
 * 聊天消息的 Markdown 渲染。
 * html:false —— 不透传原始 HTML（杜绝 LLM 输出注入 HTML/脚本）；markdown-it 内置 validateLink
 * 已拦截 javascript:/vbscript:/data: 等危险链接协议，故无需额外 DOMPurify。
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

export function renderMarkdown(src: string): string {
  return md.render(src ?? '')
}
