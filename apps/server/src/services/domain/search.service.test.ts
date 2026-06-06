import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSearchService } from './search.service.js'
import type { CollectionService, Principal } from './collection.service.js'
import type { GlobalHit, RetrievalService } from './retrieval.js'
import type { Logger } from '../../logger.js'

const P = { uid: 'u1', role: 'user' } as unknown as Principal
const logger = { info() {}, warn() {}, error() {} } as unknown as Logger

function hit(over: Partial<GlobalHit>): GlobalHit {
  return {
    marker: 1,
    chunkId: 'c1',
    documentId: 'd1',
    documentTitle: 'Doc 1',
    versionId: 'v1',
    seq: 0,
    headingPath: [],
    charStart: 0,
    charEnd: 10,
    snippet: 'snip',
    context: 'ctx',
    score: 0,
    collectionId: 'col1',
    ...over,
  }
}

function make(cols: { id: string; name: string }[], hits: GlobalHit[]) {
  const collectionService = {
    listAccessible: async () => cols,
  } as unknown as CollectionService
  const retrieval = {
    searchGlobal: async () => hits,
  } as unknown as RetrievalService
  return createSearchService({ logger, collectionService, retrieval })
}

test('search: 无可访问库 → 空结果', async () => {
  const svc = make([], [hit({})])
  assert.deepEqual(await svc.search(P, 'q'), [])
})

test('search: 文档级聚合——同文档多段命中合并并累加 hitCount', async () => {
  const svc = make(
    [{ id: 'col1', name: '库A' }],
    [
      hit({ chunkId: 'c1', documentId: 'd1', snippet: '首段' }),
      hit({ chunkId: 'c2', documentId: 'd1', snippet: '次段' }),
      hit({ chunkId: 'c3', documentId: 'd2', documentTitle: 'Doc 2' }),
    ],
  )
  const res = await svc.search(P, 'q')
  assert.equal(res.length, 2)
  assert.equal(res[0]!.documentId, 'd1')
  assert.equal(res[0]!.hitCount, 2)
  // 首见即最相关命中的摘要。
  assert.equal(res[0]!.snippet, '首段')
  assert.equal(res[1]!.documentId, 'd2')
  assert.equal(res[1]!.hitCount, 1)
})

test('search: 保留 searchGlobal 的相关性次序', async () => {
  const svc = make(
    [{ id: 'col1', name: '库A' }],
    [hit({ documentId: 'dB' }), hit({ documentId: 'dA' })],
  )
  const res = await svc.search(P, 'q')
  assert.deepEqual(
    res.map((r) => r.documentId),
    ['dB', 'dA'],
  )
})

test('search: 回填来源库名', async () => {
  const svc = make(
    [
      { id: 'col1', name: '库A' },
      { id: 'col2', name: '库B' },
    ],
    [hit({ documentId: 'd1', collectionId: 'col2' })],
  )
  const res = await svc.search(P, 'q')
  assert.equal(res[0]!.collectionName, '库B')
})
