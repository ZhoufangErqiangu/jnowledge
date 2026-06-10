import yauzl from 'yauzl'
import {
  ArchiveLimitError,
  normalizeEntryPath,
  type ArchiveEntryInfo,
  type ArchiveExtractor,
  type ArchiveLimits,
} from './types.js'

/** 打开内存中的 zip（lazyEntries：逐条目拉取，便于计数与提前终止）。 */
function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) reject(err)
      else resolve(zipfile)
    })
  })
}

/**
 * zip 解压器（yauzl）。安全要点：
 * - list 只读 central directory，不解压；条目数超限即熔断；
 * - extract 流式解码并**按实际字节计数**（声明大小可伪造），超单条目/整包限额立即销毁流；
 * - 压缩比按「实际解出字节 / 压缩字节」判（zip bomb 的声明大小恰恰是骗预检用的）；
 * - yauzl 对不安全文件名（绝对路径 / '..'）默认直接报错 → 整包拒绝，不做部分放行。
 */
export const zipExtractor: ArchiveExtractor = {
  name: 'zip',

  async list(buffer, limits) {
    const zipfile = await openZip(buffer)
    return new Promise<ArchiveEntryInfo[]>((resolve, reject) => {
      const entries: ArchiveEntryInfo[] = []
      zipfile.on('entry', (entry: yauzl.Entry) => {
        // 目录条目（以 / 结尾）不算内容条目。
        if (!entry.fileName.endsWith('/')) {
          if (entries.length >= limits.maxEntries) {
            zipfile.close()
            reject(
              new ArchiveLimitError('entries', `压缩包条目数超过上限 ${limits.maxEntries}，拒绝处理`),
            )
            return
          }
          const { path, unsafe } = normalizeEntryPath(entry.fileName)
          entries.push({ path, size: entry.uncompressedSize, ...(unsafe ? { unsafePath: true } : {}) })
        }
        zipfile.readEntry()
      })
      zipfile.on('end', () => resolve(entries))
      zipfile.on('error', reject)
      zipfile.readEntry()
    })
  },

  async extract(buffer, entryPath, limits) {
    const zipfile = await openZip(buffer)
    return new Promise<Buffer>((resolve, reject) => {
      let found = false
      const fail = (err: Error) => {
        zipfile.close()
        reject(err)
      }
      zipfile.on('entry', (entry: yauzl.Entry) => {
        const { path, unsafe } = normalizeEntryPath(entry.fileName)
        if (path !== entryPath || entry.fileName.endsWith('/')) {
          zipfile.readEntry()
          return
        }
        found = true
        if (unsafe) {
          fail(new Error(`条目路径不安全，拒绝解出: ${entryPath}`))
          return
        }
        zipfile.openReadStream(entry, (err, stream) => {
          if (err) {
            fail(err)
            return
          }
          const chunks: Buffer[] = []
          let received = 0
          const cap = Math.min(limits.maxEntryBytes, limits.maxTotalBytes)
          stream.on('data', (chunk: Buffer) => {
            received += chunk.length
            // 实际字节熔断：不等流读完，超限立即销毁（防「声明小、实际大」的 bomb）。
            if (received > cap) {
              stream.destroy()
              fail(
                new ArchiveLimitError(
                  'entry-size',
                  `条目 ${entryPath} 实际解压超过限额 ${cap} 字节，已中止`,
                ),
              )
              return
            }
            const compressed = Math.max(entry.compressedSize, 1)
            if (received > limits.ratioFloorBytes && received / compressed > limits.maxCompressionRatio) {
              stream.destroy()
              fail(
                new ArchiveLimitError(
                  'ratio',
                  `条目 ${entryPath} 压缩比超过 ${limits.maxCompressionRatio}:1，疑似压缩炸弹，已中止`,
                ),
              )
              return
            }
            chunks.push(chunk)
          })
          stream.on('end', () => {
            zipfile.close()
            resolve(Buffer.concat(chunks))
          })
          stream.on('error', fail)
        })
      })
      zipfile.on('end', () => {
        if (!found) reject(new Error(`压缩包内不存在条目: ${entryPath}`))
      })
      zipfile.on('error', fail)
      zipfile.readEntry()
    })
  },
}
