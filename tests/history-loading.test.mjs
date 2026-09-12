import assert from 'node:assert/strict'
import test from 'node:test'
import { loadRemainingHistory, mergeHistoryMessages } from '../src/history-loading.ts'

function message(id, content = id, sourceUuid) {
  return {
    id, role: 'assistant', content, createdAt: '2026-09-12T00:00:00.000Z',
    ...(sourceUuid ? { history: { sourceUuid, blocks: [{ type: 'text', text: content }] } } : {}),
  }
}

test('loads every page serially, applies it in order, and reports progress', async () => {
  const offsets = []
  const applied = []
  const progress = []
  let active = 0
  let peak = 0
  const pages = new Map([
    [4, { messages: [message('a'), message('b')], nextOffset: 7 }],
    [7, { messages: [message('c')], nextOffset: null }],
  ])
  const result = await loadRemainingHistory({
    offset: 4,
    signal: new AbortController().signal,
    async loadPage(offset) {
      offsets.push(offset); active += 1; peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return pages.get(offset)
    },
    onPage(page) { applied.push(...page.messages.map(item => item.id)) },
    onProgress(value) { progress.push(value) },
  })

  assert.deepEqual(result, { complete: true, pages: 2 })
  assert.deepEqual(offsets, [4, 7])
  assert.deepEqual(applied, ['a', 'b', 'c'])
  assert.equal(peak, 1)
  assert.deepEqual(progress, [
    { pages: 1, messages: 2, nextOffset: 7 },
    { pages: 2, messages: 3, nextOffset: null },
  ])
})

test('cancellation before or during a fetch returns a partial result without applying the fetched page', async () => {
  const before = new AbortController()
  before.abort()
  let calls = 0
  assert.deepEqual(await loadRemainingHistory({
    offset: 0, signal: before.signal,
    async loadPage() { calls += 1; return { messages: [], nextOffset: null } },
    onPage() { throw new Error('must not apply') },
  }), { complete: false, reason: 'cancelled', pages: 0 })
  assert.equal(calls, 0)

  const during = new AbortController()
  const applied = []
  assert.deepEqual(await loadRemainingHistory({
    offset: 0, signal: during.signal,
    async loadPage() { during.abort(); return { messages: [message('not-applied')], nextOffset: null } },
    onPage(page) { applied.push(page) },
  }), { complete: false, reason: 'cancelled', pages: 0 })
  assert.deepEqual(applied, [])
})

test('cancellation after an applied page keeps that page and stops before another fetch', async () => {
  const controller = new AbortController()
  const applied = []
  let calls = 0
  const result = await loadRemainingHistory({
    offset: 0, signal: controller.signal,
    async loadPage() { calls += 1; return { messages: [message('kept')], nextOffset: 1 } },
    onPage(page) { applied.push(...page.messages); controller.abort() },
  })
  assert.deepEqual(result, { complete: false, reason: 'cancelled', pages: 1 })
  assert.deepEqual(applied.map(item => item.id), ['kept'])
  assert.equal(calls, 1)
})

test('rejects invalid initial and non-increasing next cursors', async () => {
  const options = nextOffset => ({
    offset: 2, signal: new AbortController().signal,
    async loadPage() { return { messages: [], nextOffset } },
    onPage() { throw new Error('invalid pages must not be applied') },
  })
  await assert.rejects(loadRemainingHistory({ ...options(null), offset: -1 }), /non-negative safe integer/)
  for (const cursor of [-1, 1, 2, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(loadRemainingHistory(options(cursor)), /invalid next offset/)
  }
})

test('stops each action at 100 pages with an explicit resumable partial result', async () => {
  const offsets = []
  const result = await loadRemainingHistory({
    offset: 0, signal: new AbortController().signal,
    async loadPage(offset) { offsets.push(offset); return { messages: [message(String(offset))], nextOffset: offset + 1 } },
    onPage() {},
  })
  assert.deepEqual(result, { complete: false, reason: 'limit', pages: 100 })
  assert.equal(offsets.length, 100)
  assert.equal(offsets.at(-1), 99)
})

test('merges overlapping history by source UUID or id while retaining distinct records with identical text', () => {
  const current = [
    message('old-id', 'old content', 'uuid-1'),
    message('stable-id', 'old by id'),
    message('same-text-1', 'identical'),
  ]
  const incoming = [
    message('new-id', 'updated content', 'uuid-1'),
    message('stable-id', 'updated by id'),
    message('same-text-2', 'identical'),
    message('new-id', 'latest overlapping content', 'uuid-1'),
  ]

  const merged = mergeHistoryMessages(current, incoming)
  assert.deepEqual(merged.map(item => [item.id, item.content]), [
    ['new-id', 'latest overlapping content'],
    ['stable-id', 'updated by id'],
    ['same-text-1', 'identical'],
    ['same-text-2', 'identical'],
  ])
  assert.deepEqual(current.map(item => item.id), ['old-id', 'stable-id', 'same-text-1'])
})

test('a failed later page preserves applied data and its cursor for a retry', async () => {
  let current = [message('initial')]
  let nextOffset = 1
  const applied = page => { current = mergeHistoryMessages(current, page.messages); nextOffset = page.nextOffset }
  await assert.rejects(loadRemainingHistory({
    offset: nextOffset, signal: new AbortController().signal,
    async loadPage(offset) {
      if (offset === 2) throw new Error('temporarily offline')
      return { messages: [message('page-one')], nextOffset: 2 }
    },
    onPage: applied,
  }), /temporarily offline/)
  assert.deepEqual(current.map(item => item.id), ['initial', 'page-one'])
  assert.equal(nextOffset, 2)
  const retried = await loadRemainingHistory({
    offset: nextOffset, signal: new AbortController().signal,
    async loadPage(offset) { assert.equal(offset, 2); return { messages: [message('page-two')], nextOffset: null } },
    onPage: applied,
  })
  assert.equal(retried.complete, true)
  assert.deepEqual(current.map(item => item.id), ['initial', 'page-one', 'page-two'])
  assert.equal(nextOffset, null)
})
