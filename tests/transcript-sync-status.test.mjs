import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const baseChat = {
  id: 'chat-1', title: 'Chat', projectId: null, sessionId: 'session-1', model: 'sonnet', permissionMode: 'default',
  createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z', messages: [], status: 'idle',
}

test('bound app chats report checking, synced, error, and live transcript states without claiming native views are synced', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { default: TranscriptSyncStatus } = await server.ssrLoadModule('/src/TranscriptSyncStatus.tsx')
  const render = (chat, props = {}) => renderToStaticMarkup(createElement(TranscriptSyncStatus, { chat, syncing: false, connected: true, onSync() {}, ...props }))

  const checking = render(baseChat)
  assert.match(checking, /Checking Claude history/)
  assert.match(checking, /No sync result is available yet/)
  assert.doesNotMatch(checking, /Synced with Claude/)

  const synced = render({ ...baseChat, sync: { status: 'synced', checkedAt: '2026-09-12T01:00:00.000Z', sourceHash: 'sha256:abc', messageCount: 12 } })
  assert.match(synced, /Synced with Claude/)
  assert.match(synced, /12 messages checked/)
  assert.match(synced, /Transcript fingerprint: sha256:abc/)
  assert.match(synced, /does not prove the rendered conversation matches the JSONL byte-for-byte/)

  const failed = render({ ...baseChat, sync: { status: 'error', checkedAt: '2026-09-12T01:00:00.000Z', error: 'History file is unavailable' } })
  assert.match(failed, /Sync needs attention/)
  assert.match(failed, /History file is unavailable/)

  const live = render({ ...baseChat, status: 'running', sync: { status: 'error', checkedAt: '2026-09-12T01:00:00.000Z', error: 'old error' } })
  assert.match(live, /Live response/)
  assert.doesNotMatch(live, /Sync needs attention/)
  assert.match(live, /<button[^>]*disabled=""[^>]*>Sync now<\/button>/)

  assert.equal(render({ ...baseChat, sessionId: null }), '')
})

test('sync control reflects an in-flight refresh and disconnection', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { default: TranscriptSyncStatus } = await server.ssrLoadModule('/src/TranscriptSyncStatus.tsx')
  const syncing = renderToStaticMarkup(createElement(TranscriptSyncStatus, { chat: baseChat, syncing: true, connected: true, onSync() {} }))
  assert.match(syncing, /Checking Claude history/)
  assert.match(syncing, /<button[^>]*disabled=""[^>]*>Syncing…<\/button>/)
  const disconnected = renderToStaticMarkup(createElement(TranscriptSyncStatus, { chat: baseChat, syncing: false, connected: false, onSync() {} }))
  assert.match(disconnected, /Disconnected/)
  assert.match(disconnected, /Reconnect to check Claude history/)
  assert.doesNotMatch(disconnected, /Live response/)
  assert.match(disconnected, /<button[^>]*disabled=""[^>]*>Sync now<\/button>/)

  const disconnectedWithSnapshot = renderToStaticMarkup(createElement(TranscriptSyncStatus, {
    chat: { ...baseChat, status: 'running', sync: { status: 'synced', checkedAt: '2026-09-12T01:00:00.000Z' } },
    syncing: false, connected: false, onSync() {},
  }))
  assert.match(disconnectedWithSnapshot, /Disconnected/)
  assert.match(disconnectedWithSnapshot, /last successful snapshot remains available/)
  assert.match(disconnectedWithSnapshot, /Reconnect to sync/)
  assert.doesNotMatch(disconnectedWithSnapshot, /Live response/)
})

test('manual sync relies on SSE rather than applying a potentially stale POST response', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('async function syncChat()'), source.indexOf('function exportChat()'));
  assert.match(method, /const result = await api\.syncChat\(chatId\)/);
  assert.match(method, /setToast\('Claude history synced'\)/);
  assert.match(method, /setError\(result\.sync\?\.error/);
  assert.doesNotMatch(method, /applyChat/);
});
