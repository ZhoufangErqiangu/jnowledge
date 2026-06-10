import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { ZipFile } from 'yazl'
import { pack as tarPack } from 'tar-stream'
import { getExtractor } from './index.js'
import { ArchiveLimitError, normalizeEntryPath, type ArchiveLimits } from './types.js'

/** 测试用小限额（默认限额太大，测试要能快速触发熔断）。 */
const LIMITS: ArchiveLimits = {
  maxEntries: 5,
  maxEntryBytes: 64 * 1024,
  maxTotalBytes: 256 * 1024,
  maxCompressionRatio: 20,
  ratioFloorBytes: 16 * 1024,
}

const zip = getExtractor('application/zip')!
const tgz = getExtractor('application/gzip')!
const tar = getExtractor('application/x-tar')!

function buildZip(entries: Array<{ path: string; content: Buffer | string }>): Promise<Buffer> {
  const zf = new ZipFile()
  for (const e of entries) {
    zf.addBuffer(Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content), e.path)
  }
  zf.end()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    zf.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zf.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zf.outputStream.on('error', reject)
  })
}

function buildTar(entries: Array<{ path: string; content: Buffer | string }>): Promise<Buffer> {
  const p = tarPack()
  for (const e of entries) {
    p.entry({ name: e.path }, Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content))
  }
  p.finalize()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    p.on('data', (c: Buffer) => chunks.push(c))
    p.on('end', () => resolve(Buffer.concat(chunks)))
    p.on('error', reject)
  })
}

await test('normalizeEntryPath：绝对路径与 .. 段判为不安全', () => {
  assert.equal(normalizeEntryPath('docs/a.md').unsafe, false)
  assert.equal(normalizeEntryPath('./docs/a.md').path, 'docs/a.md')
  assert.equal(normalizeEntryPath('/etc/passwd').unsafe, true)
  assert.equal(normalizeEntryPath('a/../../x').unsafe, true)
  assert.equal(normalizeEntryPath('C:\\windows\\evil').unsafe, true)
})

await test('zip：list + extract 往返', async () => {
  const buf = await buildZip([
    { path: 'readme.md', content: '# hello' },
    { path: 'docs/guide.txt', content: 'guide content' },
  ])
  const entries = await zip.list(buf, LIMITS)
  assert.deepEqual(
    entries.map((e) => e.path).sort(),
    ['docs/guide.txt', 'readme.md'],
  )
  const out = await zip.extract(buf, 'docs/guide.txt', LIMITS)
  assert.equal(out.toString(), 'guide content')
})

await test('zip：条目数超限熔断', async () => {
  const buf = await buildZip(
    Array.from({ length: LIMITS.maxEntries + 1 }, (_, i) => ({ path: `f${i}.txt`, content: 'x' })),
  )
  await assert.rejects(zip.list(buf, LIMITS), (err: unknown) => {
    assert.ok(err instanceof ArchiveLimitError)
    assert.equal(err.limit, 'entries')
    return true
  })
})

await test('zip：高压缩比条目（压缩炸弹）按实际字节熔断', async () => {
  // 4MB 全零压缩后极小 → 解压时实际计数触发 entry-size 或 ratio 熔断（不信声明大小）。
  const buf = await buildZip([{ path: 'bomb.bin', content: Buffer.alloc(4 * 1024 * 1024) }])
  await assert.rejects(zip.extract(buf, 'bomb.bin', LIMITS), (err: unknown) => {
    assert.ok(err instanceof ArchiveLimitError)
    assert.ok(err.limit === 'entry-size' || err.limit === 'ratio')
    return true
  })
})

await test('zip：不存在的条目报错', async () => {
  const buf = await buildZip([{ path: 'a.txt', content: 'a' }])
  await assert.rejects(zip.extract(buf, 'missing.txt', LIMITS), /不存在条目/)
})

await test('tar.gz：list + extract 往返', async () => {
  const buf = gzipSync(
    await buildTar([
      { path: 'notes/a.md', content: '# a' },
      { path: 'notes/b.md', content: 'b content' },
    ]),
  )
  const entries = await tgz.list(buf, LIMITS)
  assert.deepEqual(entries.map((e) => e.path), ['notes/a.md', 'notes/b.md'])
  const out = await tgz.extract(buf, 'notes/b.md', LIMITS)
  assert.equal(out.toString(), 'b content')
})

await test('tar：不带 gzip 也可处理', async () => {
  const buf = await buildTar([{ path: 'x.txt', content: 'plain tar' }])
  const out = await tar.extract(buf, 'x.txt', LIMITS)
  assert.equal(out.toString(), 'plain tar')
})

await test('tar.gz：gzip 炸弹在 list 阶段即被总量熔断', async () => {
  // 1MB 全零的 tar gzip 后 ~1KB；总量限把 maxTotalBytes 压到 128KB 触发。
  const tight: ArchiveLimits = { ...LIMITS, maxTotalBytes: 128 * 1024, maxCompressionRatio: 10_000 }
  const buf = gzipSync(await buildTar([{ path: 'bomb.bin', content: Buffer.alloc(1024 * 1024) }]))
  await assert.rejects(tgz.list(buf, tight), (err: unknown) => {
    assert.ok(err instanceof ArchiveLimitError)
    assert.equal(err.limit, 'total-size')
    return true
  })
})

await test('tar.gz：压缩比超限熔断', async () => {
  const buf = gzipSync(await buildTar([{ path: 'bomb.bin', content: Buffer.alloc(1024 * 1024) }]))
  await assert.rejects(tgz.extract(buf, 'bomb.bin', { ...LIMITS, maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 }), (err: unknown) => {
    assert.ok(err instanceof ArchiveLimitError)
    assert.equal(err.limit, 'ratio')
    return true
  })
})

await test('tar：不安全路径条目被列出但拒绝解出', async () => {
  const buf = await buildTar([{ path: 'a/../../etc/passwd', content: 'evil' }])
  const entries = await tar.list(buf, LIMITS)
  assert.equal(entries[0]?.unsafePath, true)
  await assert.rejects(tar.extract(buf, entries[0]!.path, LIMITS), /不安全/)
})

await test('gzip 内不是 tar 时报错而非挂起', async () => {
  const buf = gzipSync(Buffer.from('just a text file, not a tar'))
  await assert.rejects(tgz.list(buf, LIMITS))
})
