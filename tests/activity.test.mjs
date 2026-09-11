import assert from 'node:assert/strict'
import test from 'node:test'
import { activitySummary, buildConversationItems } from '../src/activity-model.ts'

const message = (id, role, blocks, extra = {}) => ({
  id, role, content: blocks.filter(block => block.type === 'text').map(block => block.text).join(''),
  createdAt: '2026-09-11T00:00:00.000Z', history: { sourceUuid: id, blocks }, ...extra,
})

test('preserves text before, between, and after activity in native history', () => {
  const items = buildConversationItems([message('a', 'assistant', [
    { type: 'text', text: 'Before' },
    { type: 'tool', id: 'one', name: 'Read', input: { file_path: '/tmp/one.ts' }, status: 'complete' },
    { type: 'text', text: 'Between' },
    { type: 'tool', id: 'two', name: 'Bash', input: { command: 'npm test' }, status: 'complete' },
    { type: 'text', text: 'After' },
  ])])
  assert.deepEqual(items.map(item => item.type), ['message', 'activity', 'message', 'activity', 'message'])
  assert.deepEqual(items.filter(item => item.type === 'message').map(item => item.message.content), ['Before', 'Between', 'After'])
  assert.equal(items[0].message.history.sourceUuid, 'a')
  assert.deepEqual(items[0].message.history.blocks, [{ type: 'text', text: 'Before' }])
})

test('groups consecutive activity across native message boundaries and pairs results', () => {
  const items = buildConversationItems([
    message('call', 'assistant', [{ type: 'tool', id: 'read-1', name: 'Read', input: { file_path: '/repo/src/App.tsx' }, status: 'running' }]),
    message('result', 'user', [{ type: 'toolResult', toolUseId: 'read-1', content: 'source text' }]),
    message('next', 'assistant', [{ type: 'tool', id: 'bash-1', name: 'Bash', input: { command: 'npm test' }, status: 'complete' }]),
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].type, 'activity')
  assert.equal(items[0].tools.length, 2)
  assert.deepEqual(items[0].tools[0].result, { content: 'source text', isError: false })
  assert.equal(items[0].tools[0].status, 'complete')
})

test('real user text breaks activity grouping', () => {
  const items = buildConversationItems([
    message('call', 'assistant', [{ type: 'tool', id: 'a', name: 'Read', input: {}, status: 'complete' }]),
    message('user', 'user', [{ type: 'text', text: 'Stop there' }]),
    message('call-2', 'assistant', [{ type: 'tool', id: 'b', name: 'Edit', input: {}, status: 'complete' }]),
  ])
  assert.deepEqual(items.map(item => item.type), ['activity', 'message', 'activity'])
  assert.equal(items[1].message.role, 'user')
})

test('keeps error and unpaired result data readable without duplicating a paired row', () => {
  const items = buildConversationItems([
    message('paired', 'assistant', [
      { type: 'tool', id: 'x', name: 'Write', input: { path: '/tmp/x' }, status: 'complete' },
      { type: 'toolResult', toolUseId: 'x', content: 'denied', isError: true },
      { type: 'toolResult', toolUseId: 'missing', content: { detail: 'not loaded' }, isError: true },
    ]),
  ])
  assert.equal(items[0].tools.length, 2)
  assert.equal(items[0].tools[0].result.isError, true)
  assert.equal(items[0].tools[1].resultOnly, true)
  assert.deepEqual(items[0].tools[1].result.content, { detail: 'not loaded' })
})

test('live tools stay before content, expose running state, and terminal states remain outside activity', () => {
  const live = { id: 'live', role: 'assistant', content: 'Done', createdAt: '', status: 'error', error: 'failed', tools: [
    { id: 'run', name: 'Bash', input: { command: 'sleep 1' }, status: 'running' },
  ] }
  const items = buildConversationItems([live])
  assert.deepEqual(items.map(item => item.type), ['activity', 'message', 'message'])
  assert.equal(items[0].tools[0].status, 'running')
  assert.equal(items[1].message.content, 'Done')
  assert.equal(items[2].message.status, 'error')
  assert.equal(items[2].message.error, 'failed')
})

test('live streaming content retains its working state without becoming historical', () => {
  const items = buildConversationItems([{ id: 'stream', role: 'assistant', content: 'So far', createdAt: '', status: 'streaming' }])
  assert.equal(items[0].message.status, 'streaming')
  assert.equal(items[0].message.history, undefined)
})

test('tool-only assistant usage stays on its grouped activity exactly once', () => {
  const usage = { inputTokens: 120, outputTokens: 8, costUsd: 0.01 }
  const items = buildConversationItems([
    message('call', 'assistant', [
      { type: 'tool', id: 'read-usage', name: 'Read', input: { file_path: '/repo/a.ts' }, status: 'complete' },
    ], { usage }),
    message('result', 'user', [
      { type: 'toolResult', toolUseId: 'read-usage', content: 'file contents' },
    ], { usage: { inputTokens: 999, outputTokens: 999 } }),
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].type, 'activity')
  assert.deepEqual(items[0].usageEntries, [{ messageId: 'call', usage }])
})

test('split assistant records give usage only to their final text or activity item', () => {
  const toolEndingUsage = { inputTokens: 20, outputTokens: 3 }
  const textEndingUsage = { inputTokens: 30, outputTokens: 4 }
  const items = buildConversationItems([
    message('tool-ending', 'assistant', [
      { type: 'text', text: 'I will check.' },
      { type: 'tool', id: 'check', name: 'Bash', input: { command: 'npm test' }, status: 'complete' },
    ], { usage: toolEndingUsage }),
    message('text-ending', 'assistant', [
      { type: 'text', text: 'First.' },
      { type: 'tool', id: 'read', name: 'Read', input: { file_path: '/repo/b.ts' }, status: 'complete' },
      { type: 'text', text: 'Finished.' },
    ], { usage: textEndingUsage }),
  ])

  assert.deepEqual(items.map(item => item.type), ['message', 'activity', 'message', 'activity', 'message'])
  assert.equal(items[0].message.usage, undefined)
  assert.deepEqual(items[1].usageEntries, [{ messageId: 'tool-ending', usage: toolEndingUsage }])
  assert.equal(items[2].message.usage, undefined)
  assert.equal(items[3].usageEntries, undefined)
  assert.deepEqual(items[4].message.usage, textEndingUsage)
})

test('terminal error item owns live assistant usage instead of earlier content', () => {
  const usage = { inputTokens: 42, outputTokens: 5 }
  const items = buildConversationItems([{
    id: 'failed', role: 'assistant', content: 'Partial answer', createdAt: '', status: 'error', error: 'failed', usage,
  }])

  assert.equal(items.length, 2)
  assert.equal(items[0].message.usage, undefined)
  assert.deepEqual(items[1].message.usage, usage)
})

test('activity summary reports friendly action counts with a safe fallback', () => {
  assert.equal(activitySummary([
    ...Array.from({ length: 4 }, (_, index) => ({ id: `r${index}`, name: 'Read', input: {}, status: 'complete' })),
    { id: 'b1', name: 'Bash', input: {}, status: 'complete' },
    { id: 'b2', name: 'Bash', input: {}, status: 'complete' },
    { id: 'custom', name: 'Fetch', input: {}, status: 'complete' },
  ]), 'Read 4 files · Ran 2 commands · Fetch 1')
})
