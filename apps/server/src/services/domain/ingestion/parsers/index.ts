import { type DetectedKind } from './detectType.js'
import type { Parser } from './types.js'
import { pdfParser } from './pdf.parser.js'
import { docxParser } from './docx.parser.js'
import { htmlParser } from './html.parser.js'
import { plainTextParser } from './plainText.parser.js'

/**
 * Parser Registry：检测出的真实类型 → 解析器（显式注册，无动态扫描）。
 * 新增格式 = 加一个 parser + 在此映射一行。
 */
const REGISTRY: Record<DetectedKind, Parser> = {
  pdf: pdfParser,
  docx: docxParser,
  html: htmlParser,
  text: plainTextParser,
}

export function getParser(kind: DetectedKind): Parser {
  return REGISTRY[kind]
}

export * from './types.js'
export * from './detectType.js'
