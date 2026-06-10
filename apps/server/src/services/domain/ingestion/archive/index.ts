import type { ArchiveExtractor } from './types.js'
import { zipExtractor } from './zip.extractor.js'
import { createTarExtractor } from './tar.extractor.js'

/**
 * Extractor Registry：检测出的真实 MIME（detectType kind='archive' 时）→ 解压器。
 * 与 parser registry 同构：新增格式 = 加一个 extractor + 在此映射一行。
 * gzip 按 tar.gz 处理（非 tar 内容的 .gz 解析时自然报错）。
 */
const REGISTRY: Record<string, ArchiveExtractor> = {
  'application/zip': zipExtractor,
  'application/gzip': createTarExtractor(true),
  'application/x-tar': createTarExtractor(false),
}

export function getExtractor(mimeType: string): ArchiveExtractor | undefined {
  return REGISTRY[mimeType]
}

export * from './types.js'
