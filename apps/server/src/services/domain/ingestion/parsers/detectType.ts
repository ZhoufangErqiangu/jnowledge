import { fileTypeFromBuffer } from 'file-type'

/** 规范化的内部文件类别（与客户端声称的 MIME 解耦）。 */
export type DetectedKind = 'pdf' | 'docx' | 'html' | 'text'

export interface DetectedType {
  kind: DetectedKind
  /** 落 files.mime_type 的真实 MIME */
  mimeType: string
}

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * 按魔数检测真实类型（不信扩展名/客户端 MIME，兼做安全边界）。
 * 纯文本格式无魔数 → 内容启发式兜底：嗅探是否 HTML，否则按 text/markdown。
 */
export async function detectType(buffer: Buffer): Promise<DetectedType> {
  const ft = await fileTypeFromBuffer(buffer)
  if (ft) {
    if (ft.mime === PDF_MIME) return { kind: 'pdf', mimeType: PDF_MIME }
    if (ft.mime === DOCX_MIME) return { kind: 'docx', mimeType: DOCX_MIME }
    // 其它有魔数但非受支持类型 → 交给上层判 UNSUPPORTED_FILE_TYPE
    return { kind: 'text', mimeType: ft.mime }
  }

  // 无魔数：内容启发式
  const head = buffer.subarray(0, 1024).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<body')) {
    return { kind: 'html', mimeType: 'text/html' }
  }
  return { kind: 'text', mimeType: 'text/plain' }
}

/** 受支持的真实类型集合（detectType 之后用于网关校验）。 */
export const SUPPORTED_KINDS: ReadonlySet<DetectedKind> = new Set(['pdf', 'docx', 'html', 'text'])
