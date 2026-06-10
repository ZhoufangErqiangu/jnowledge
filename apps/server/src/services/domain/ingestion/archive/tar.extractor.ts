import { Readable, type Duplex } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { extract as tarExtract, type Headers } from 'tar-stream'
import {
  ArchiveLimitError,
  normalizeEntryPath,
  type ArchiveEntryInfo,
  type ArchiveExtractor,
  type ArchiveLimits,
} from './types.js'

interface WalkResult {
  entries: ArchiveEntryInfo[]
  /** target 命中时解出的内容。 */
  collected?: Buffer
}

/**
 * 顺序扫描 tar（可选先 gunzip）。tar 是流式格式：list 也必须把整流走一遍，
 * 因此**扫描全程按实际解出字节计数**并受 maxTotalBytes 熔断——gzip bomb 在 list 阶段就会被掐断。
 * tar.gz 没有逐条目压缩大小，压缩比按「累计解出字节 / 整包压缩字节」持续判定。
 */
function walk(
  buffer: Buffer,
  gzipped: boolean,
  limits: ArchiveLimits,
  target?: string,
): Promise<WalkResult> {
  return new Promise((resolve, reject) => {
    const entries: ArchiveEntryInfo[] = []
    const chunks: Buffer[] = []
    let total = 0
    let collectedSize = 0
    let foundTarget = false
    let settled = false

    const source = Readable.from([buffer])
    const gunzip: Duplex | null = gzipped ? createGunzip() : null
    const ex = tarExtract()

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      source.destroy()
      gunzip?.destroy()
      ex.destroy()
      if (err) reject(err)
      else if (target && !foundTarget) reject(new Error(`压缩包内不存在条目: ${target}`))
      else resolve({ entries, ...(foundTarget ? { collected: Buffer.concat(chunks) } : {}) })
    }

    /** 累计实际解出字节并判限额；超限返回熔断错误。 */
    const account = (n: number): ArchiveLimitError | null => {
      total += n
      if (total > limits.maxTotalBytes) {
        return new ArchiveLimitError(
          'total-size',
          `压缩包累计解压超过限额 ${limits.maxTotalBytes} 字节，已中止`,
        )
      }
      if (
        gzipped &&
        total > limits.ratioFloorBytes &&
        total / buffer.length > limits.maxCompressionRatio
      ) {
        return new ArchiveLimitError(
          'ratio',
          `压缩比超过 ${limits.maxCompressionRatio}:1，疑似压缩炸弹，已中止`,
        )
      }
      return null
    }

    ex.on('entry', (header: Headers, stream: Readable, next: () => void) => {
      const isFile = header.type === 'file' || header.type === undefined
      const { path, unsafe } = normalizeEntryPath(header.name)
      if (isFile) {
        if (entries.length >= limits.maxEntries) {
          finish(new ArchiveLimitError('entries', `压缩包条目数超过上限 ${limits.maxEntries}，拒绝处理`))
          return
        }
        entries.push({ path, size: header.size ?? 0, ...(unsafe ? { unsafePath: true } : {}) })
      }
      const collecting = isFile && target !== undefined && path === target
      if (collecting) {
        if (unsafe) {
          finish(new Error(`条目路径不安全，拒绝解出: ${target}`))
          return
        }
        foundTarget = true
      }
      stream.on('data', (chunk: Buffer) => {
        const overflow = account(chunk.length)
        if (overflow) {
          finish(overflow)
          return
        }
        if (collecting) {
          collectedSize += chunk.length
          if (collectedSize > limits.maxEntryBytes) {
            finish(
              new ArchiveLimitError(
                'entry-size',
                `条目 ${target} 实际解压超过限额 ${limits.maxEntryBytes} 字节，已中止`,
              ),
            )
            return
          }
          chunks.push(chunk)
        }
      })
      stream.on('end', () => {
        // 目标已到手即提前收工，后续条目不再解压。
        if (collecting) finish()
        else next()
      })
      stream.on('error', finish)
    })
    ex.on('finish', () => finish())
    ex.on('error', (err: Error) => finish(err instanceof Error ? err : new Error('tar 解析失败')))
    if (gunzip) {
      gunzip.on('error', (err: Error) => finish(new Error(`gzip 解压失败: ${err.message}`)))
      source.pipe(gunzip).pipe(ex)
    } else {
      source.pipe(ex)
    }
  })
}

/** tar / tar.gz(tgz) 解压器（tar-stream + zlib）。 */
export function createTarExtractor(gzipped: boolean): ArchiveExtractor {
  return {
    name: gzipped ? 'tar.gz' : 'tar',
    async list(buffer, limits) {
      const { entries } = await walk(buffer, gzipped, limits)
      return entries
    },
    async extract(buffer, entryPath, limits) {
      const { collected } = await walk(buffer, gzipped, limits, entryPath)
      // walk 命中 target 必有 collected（未命中已 reject）；空文件为合法的零长 Buffer。
      return collected ?? Buffer.alloc(0)
    },
  }
}
