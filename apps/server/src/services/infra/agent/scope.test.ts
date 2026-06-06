import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inCeiling, narrow, outOfScope } from './scope.js'
import type { Scope } from './types.js'

test('inCeiling: principal 恒过', () => {
  const s: Scope = { ceiling: 'principal' }
  assert.equal(inCeiling(s, 'any-collection'), true)
})

test('inCeiling: 数组按成员判定', () => {
  const s: Scope = { ceiling: ['a', 'b'] }
  assert.equal(inCeiling(s, 'a'), true)
  assert.equal(inCeiling(s, 'c'), false)
})

test('narrow: 缺省请求 → 继承父天花板（不加宽）', () => {
  assert.deepEqual(narrow({ ceiling: 'principal' }), { ceiling: 'principal' })
  assert.deepEqual(narrow({ ceiling: ['a', 'b'] }), { ceiling: ['a', 'b'] })
})

test('narrow: 父 principal → 子取请求集', () => {
  assert.deepEqual(narrow({ ceiling: 'principal' }, ['a', 'b']), { ceiling: ['a', 'b'] })
})

test('narrow: 父数组 → 取交集（只收窄）', () => {
  assert.deepEqual(narrow({ ceiling: ['a', 'b'] }, ['b', 'c']), { ceiling: ['b'] })
})

test('narrow: 永不加宽——请求超出父的库被丢弃', () => {
  assert.deepEqual(narrow({ ceiling: ['a'] }, ['a', 'b', 'c']), { ceiling: ['a'] })
})

test('outOfScope: 结构化越界回执', () => {
  const r = outOfScope('x', { ceiling: ['a'] })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'out_of_scope')
  assert.match(r.summary, /out_of_scope：x/)
})
