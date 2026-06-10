import { z } from 'zod'
import type { FileRepo, FileRow } from '../../../../models/file.repo.js'
import type { StorageService } from '../../../infra/storage.js'
import type { RunContext, Tool, ToolResult } from '../../../infra/agent/index.js'
import { detectType, getParser, SUPPORTED_KINDS } from '../../ingestion/parsers/index.js'
import {
  ArchiveLimitError,
  DEFAULT_ARCHIVE_LIMITS,
  getExtractor,
} from '../../ingestion/archive/index.js'

export interface FileToolDeps {
  files: FileRepo
  storage: StorageService
}

/** inspect_file 的条目清单最多展示多少条（防超长输出冲爆上下文；总数仍如实报告）。 */
const LIST_DISPLAY_CAP = 200
/** read_file_entry 预览的最大字符数。 */
const PREVIEW_CHARS = 3000

const inspectParamsSchema = z.object({
  fileId: z.string().describe('要查看的已上传文件 id'),
})

const readParamsSchema = z.object({
  fileId: z.string().describe('已上传文件 id'),
  entryPath: z
    .string()
    .optional()
    .describe('压缩包内条目路径（取自 inspect_file 的清单）；非压缩包文件省略'),
})

/**
 * 文件只读工具（inspect_file / read_file_entry）：供文件处理 agent 查看上传文件。
 * 读边界与 importFromFile 一致——文件不挂库，按上传者（或 admin）守；
 * 压缩包一律经 ingestion/archive 安全解压器（实际字节计数熔断，不信声明大小）。
 */
export function createFileTools(deps: FileToolDeps): Tool[] {
  /** 按 id 取文件并校验读权限；不可见与不存在同响应（不泄露存在性）。 */
  async function loadFile(fileId: string, ctx: RunContext): Promise<FileRow | null> {
    const row = await deps.files.findById(fileId)
    if (!row) return null
    if (row.created_by !== ctx.principal.uid && ctx.principal.role !== 'admin') return null
    return row
  }

  function notFound(name: string, fileId: string): ToolResult {
    return {
      ok: false,
      output: '文件不存在或无权访问',
      summary: `${name}(${fileId})：未找到`,
      error: 'not found',
    }
  }

  function limitError(name: string, err: ArchiveLimitError): ToolResult {
    return {
      ok: false,
      output: `安全限额熔断：${err.message}。该压缩包（或条目）超出系统允许的解压规模，请告知用户无法处理。`,
      summary: `${name}：解压安全熔断（${err.limit}）`,
      error: err.message,
    }
  }

  const inspectFile: Tool = {
    name: 'inspect_file',
    description:
      '查看一个已上传文件的真实类型与基本信息；若是压缩包（zip/tar.gz/tar），列出其条目清单（路径与声明大小）。处理任何文件前先调用此工具。',
    paramsSchema: inspectParamsSchema,
    handler: async (args, ctx): Promise<ToolResult> => {
      const { fileId } = args as z.infer<typeof inspectParamsSchema>
      const row = await loadFile(fileId, ctx)
      if (!row) return notFound('inspect_file', fileId)

      const header = `文件「${row.original_name ?? fileId}」：类型 ${row.mime_type}，大小 ${row.file_size} 字节`
      const extractor = getExtractor(row.mime_type)
      if (!extractor) {
        return {
          ok: true,
          output: `${header}。非压缩包，可用 read_file_entry(fileId) 预览内容，或 import_file_entry 直接导入知识库。`,
          summary: `inspect_file：${row.mime_type}（${row.file_size} 字节）`,
        }
      }

      let buffer: Buffer
      try {
        buffer = await deps.storage.getObject(row.storage_key)
      } catch {
        return notFound('inspect_file', fileId)
      }
      try {
        const entries = await extractor.list(buffer, DEFAULT_ARCHIVE_LIMITS)
        const shown = entries.slice(0, LIST_DISPLAY_CAP)
        const lines = shown.map(
          (e) => `- ${e.path}（声明 ${e.size} 字节）${e.unsafePath ? '【路径不安全，不可解出】' : ''}`,
        )
        const more =
          entries.length > shown.length ? `\n…清单过长仅展示前 ${shown.length} 条，共 ${entries.length} 条。` : ''
        return {
          ok: true,
          output: [
            `${header}，压缩包共 ${entries.length} 个条目：`,
            ...lines,
            more,
            '可用 read_file_entry(fileId, entryPath) 预览条目内容，import_file_entry 导入条目；声明大小可被伪造，实际解压受安全限额保护。嵌套压缩包条目不可导入。',
          ]
            .filter(Boolean)
            .join('\n'),
          summary: `inspect_file：${extractor.name} 压缩包，${entries.length} 个条目`,
        }
      } catch (err) {
        if (err instanceof ArchiveLimitError) return limitError('inspect_file', err)
        const msg = err instanceof Error ? err.message : '解析失败'
        return {
          ok: false,
          output: `压缩包解析失败：${msg}`,
          summary: `inspect_file：解析失败`,
          error: msg,
        }
      }
    },
  }

  const readFileEntry: Tool = {
    name: 'read_file_entry',
    description:
      '预览一个已上传文件（或其压缩包内某条目）解析后的文本内容开头，用于判断内容价值与拟定标题。不会入库。',
    paramsSchema: readParamsSchema,
    handler: async (args, ctx): Promise<ToolResult> => {
      const { fileId, entryPath } = args as z.infer<typeof readParamsSchema>
      const row = await loadFile(fileId, ctx)
      if (!row) return notFound('read_file_entry', fileId)

      let buffer: Buffer
      try {
        buffer = await deps.storage.getObject(row.storage_key)
      } catch {
        return notFound('read_file_entry', fileId)
      }
      const label = entryPath ? `${row.original_name ?? fileId} 内条目 ${entryPath}` : (row.original_name ?? fileId)
      try {
        if (entryPath) {
          const extractor = getExtractor(row.mime_type)
          if (!extractor) {
            return {
              ok: false,
              output: `该文件不是受支持的压缩包（${row.mime_type}），不能按条目读取；直接省略 entryPath。`,
              summary: 'read_file_entry：非压缩包',
              error: 'not an archive',
            }
          }
          buffer = await extractor.extract(buffer, entryPath, DEFAULT_ARCHIVE_LIMITS)
        }
        const detected = await detectType(buffer)
        if (!SUPPORTED_KINDS.has(detected.kind)) {
          const why = detected.kind === 'archive' ? '是嵌套压缩包（不支持递归解压）' : `是二进制类型 ${detected.mimeType}`
          return {
            ok: false,
            output: `「${label}」${why}，无法解析为文本，也无法导入知识库。`,
            summary: `read_file_entry：不支持的类型 ${detected.mimeType}`,
            error: 'unsupported type',
          }
        }
        const { markdown } = await getParser(detected.kind).parse({
          buffer,
          mimeType: detected.mimeType,
          ...(entryPath ? { filename: entryPath } : {}),
        })
        const preview = markdown.length > PREVIEW_CHARS ? `${markdown.slice(0, PREVIEW_CHARS)}…` : markdown
        return {
          ok: true,
          output: `「${label}」（${detected.mimeType}，解析后 ${markdown.length} 字）内容开头：\n\n${preview}`,
          summary: `read_file_entry：${label}（${markdown.length} 字）`,
        }
      } catch (err) {
        if (err instanceof ArchiveLimitError) return limitError('read_file_entry', err)
        const msg = err instanceof Error ? err.message : '读取失败'
        return {
          ok: false,
          output: `读取失败：${msg}`,
          summary: 'read_file_entry：读取失败',
          error: msg,
        }
      }
    },
  }

  return [inspectFile, readFileEntry]
}
