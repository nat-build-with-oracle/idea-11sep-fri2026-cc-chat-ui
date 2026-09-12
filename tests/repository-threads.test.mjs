import assert from 'node:assert/strict'
import test from 'node:test'
import { sortRepositoryThreads } from '../src/repository-threads.ts'

const chat = (id, title, updatedAt) => ({ id, title, updatedAt, createdAt: updatedAt })
const session = (sessionId, name, updatedAt, startedAt = 0) => ({ sessionId, id: sessionId, name, updatedAt, startedAt })

test('repository threads sort app chats and native sessions together by real latest update', () => {
  const result = sortRepositoryThreads(
    [chat('chat-old', 'Zulu', '2026-09-10T00:00:00.000Z'), chat('chat-new', 'Beta', '2026-09-12T00:00:00.000Z')],
    [session('native-middle', 'Alpha', Date.parse('2026-09-11T00:00:00.000Z'))],
    'updated',
  )
  assert.deepEqual(result.map(row => [row.kind, row.item.id]), [
    ['chat', 'chat-new'], ['native', 'native-middle'], ['chat', 'chat-old'],
  ])
})

test('repository threads sort names naturally and case-insensitively without mutating inputs', () => {
  const chats = [chat('chat-10', 'Thread 10', '2026-09-12T00:00:00.000Z')]
  const sessions = [session('native-2', 'thread 2', 1), session('native-alpha', 'Alpha', 2)]
  const result = sortRepositoryThreads(chats, sessions, 'name')
  assert.deepEqual(result.map(row => row.item.id), ['native-alpha', 'native-2', 'chat-10'])
  assert.deepEqual(chats.map(row => row.id), ['chat-10'])
  assert.deepEqual(sessions.map(row => row.id), ['native-2', 'native-alpha'])
})

test('native latest ordering falls back to session start when modification time is unavailable', () => {
  const result = sortRepositoryThreads([], [session('older', 'Older', null, 1), session('newer', 'Newer', undefined, 2)], 'updated')
  assert.deepEqual(result.map(row => row.item.id), ['newer', 'older'])
})
