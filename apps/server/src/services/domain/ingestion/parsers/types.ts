/** 解析器统一契约：任意源格式 → 规范 Markdown。 */
export interface ParseInput {
  buffer: Buffer
  /** 服务端按魔数检测出的真实 MIME */
  mimeType: string
  filename?: string | undefined
}

export interface ParseResult {
  /** 归一化后的规范 Markdown（chunking 的唯一输入形态） */
  markdown: string
}

export interface Parser {
  readonly name: string
  parse(input: ParseInput): Promise<ParseResult>
}

/** 把任意空白噪声收敛成规范 Markdown：统一换行、压多余空行、去行尾空格。 */
export function normalizeMarkdown(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
