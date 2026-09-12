import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileMessages, transcriptHash } from '../server/transcript-sync.mjs';

const native = (id, role, text, blocks = [{ type: 'text', text }]) => ({ id, role, content: text, createdAt: '2026-09-12T00:00:00.000Z', status: 'complete', history: { sourceUuid: id, blocks } });
const app = (id, role, content, extra = {}) => ({ id, role, content, createdAt: '2026-09-12T00:00:00.000Z', status: 'complete', ...extra });

test('legacy app turns bind to native UUIDs; CLI additions appear once and usage survives', () => {
  const usage = { inputTokens: 12, outputTokens: 3, costUsd: 0.1, scope: 'allModels' };
  const cached = [app('app-u', 'user', 'hello'), app('app-a', 'assistant', 'Hi', { usage })];
  const source = [native('u1', 'user', 'hello'), native('a1', 'assistant', 'Hi'), native('u2', 'user', 'again'), native('a2', 'assistant', 'Latest')];
  const synced = reconcileMessages(cached, source);
  assert.deepEqual(synced.map(m => m.content), ['hello', 'Hi', 'again', 'Latest']);
  assert.equal(synced[0].id, 'app-u'); assert.equal(synced[1].id, 'app-a');
  assert.deepEqual(synced[1].usage, usage);
  assert.deepEqual(synced[1].nativeSourceIds, ['a1']);
  assert.deepEqual(reconcileMessages(synced, source), synced);
});

test('identical prompts and responses are separate occurrences, not content-hash duplicates', () => {
  const source = [native('u1', 'user', 'same'), native('a1', 'assistant', 'ok'), native('u2', 'user', 'same'), native('a2', 'assistant', 'ok')];
  const cached = [app('x', 'user', 'same'), app('y', 'assistant', 'ok')];
  const bound = reconcileMessages(cached, source.slice(0, 2));
  const synced = reconcileMessages(bound, source);
  assert.equal(synced.length, 4);
  assert.deepEqual(reconcileMessages(synced, source), synced);
});

test('legacy aggregated response retains ordered tool inputs, outputs and usage exactly once', () => {
  const tool = { type: 'tool', id: 't', name: 'Read', input: { file_path: 'a' }, status: 'complete' };
  const source = [native('u', 'user', 'read'), native('a', 'assistant', 'Before', [{ type: 'text', text: 'Before' }, tool]), native('r', 'user', '', [{ type: 'toolResult', toolUseId: 't', content: 'result' }]), native('b', 'assistant', 'After')];
  source[1].tools = [tool];
  const cached = [app('x', 'user', 'read'), app('y', 'assistant', 'BeforeAfter', { tools: [tool], usage: { inputTokens: 42, outputTokens: 7 } })];
  const synced = reconcileMessages(cached, source);
  assert.equal(synced.length, 2);
  assert.deepEqual(synced[1].nativeSourceIds, ['a', 'r', 'b']);
  assert.deepEqual(synced[1].history.blocks.map(b => b.type), ['text', 'tool', 'toolResult', 'text']);
  assert.equal(synced[1].usage.inputTokens, 42);
  assert.deepEqual(reconcileMessages(synced, source), synced);
});

test('native UUID updates replace content, while vanished or unmatched saved messages fail safely', () => {
  const source = [native('u', 'user', 'hello'), native('a', 'assistant', 'before')];
  const synced = reconcileMessages([], source);
  const changed = [source[0], native('a', 'assistant', 'after')];
  assert.equal(reconcileMessages(synced, changed)[1].content, 'after');
  assert.throws(() => reconcileMessages(synced, [source[0]]), /saved messages/);
  assert.throws(() => reconcileMessages([app('x', 'user', 'missing')], source), /saved messages/);
  assert.throws(() => reconcileMessages(synced, []), /saved messages/);
  assert.equal(synced[1].content, 'before');
});

test('CLI output absent from the SDK snapshot stays local and can bind if Claude later persists it', () => {
  const source = [native('u', 'user', '/list-agents')];
  const cached = [
    app('app-u', 'user', '/list-agents'),
    app('app-a', 'assistant', 'Agent list', { nativeSourceIds: ['late-a'] }),
  ];
  const first = reconcileMessages(cached, source);
  assert.deepEqual(first.map(message => message.content), ['/list-agents', 'Agent list']);
  assert.equal(first[1].appOnly, true);
  assert.deepEqual(first[1].nativeSourceIds, ['late-a']);

  const persisted = [...source, native('late-a', 'assistant', 'Agent list')];
  const second = reconcileMessages(first, persisted);
  assert.deepEqual(second.map(message => message.content), ['/list-agents', 'Agent list']);
  assert.equal(second[1].appOnly, undefined);
  assert.deepEqual(second[1].nativeSourceIds, ['late-a']);
});

test('transcript hash ignores object key order but includes UUIDs, content, tools and order', () => {
  const source = [native('u', 'user', 'hi')];
  const reordered = [{ history: source[0].history, status: 'complete', createdAt: source[0].createdAt, content: 'hi', role: 'user', id: 'u' }];
  assert.equal(transcriptHash(source), transcriptHash(reordered));
  assert.notEqual(transcriptHash(source), transcriptHash([native('v', 'user', 'hi')]));
  assert.notEqual(transcriptHash(source), transcriptHash([native('u', 'user', 'changed')]));
});

import { TranscriptSync } from '../server/transcript-sync.mjs';
function memoryStore(messages = []) {
  let state = { chats: [{ id: 'chat', sessionId: 'session', status: 'idle', messages }] };
  return { writes: 0, snapshot: () => structuredClone(state), async update(mutator) { const draft = structuredClone(state); const result = mutator(draft); state = draft; this.writes++; return result; } };
}

test('sync metadata touches do not write/broadcast unchanged content and forced audit ignores token', async () => {
  const store = memoryStore();
  const source = [native('u', 'user', 'hello')];
  let revision = 'one'; const tokens = [];
  const sync = new TranscriptSync({ store, intervalMs: 0, nativeSessions: { async historySnapshot(id, token) { tokens.push(token); return token === revision ? null : { changeToken: revision, messages: source }; } } });
  await sync.syncChat('chat');
  const original = store.snapshot();
  await sync.syncChat('chat');
  revision = 'touch';
  await sync.syncChat('chat');
  await sync.syncChat('chat', { force: true });
  assert.deepEqual(store.snapshot(), original);
  assert.equal(store.writes, 1);
  assert.deepEqual(tokens, [null, 'one', 'one', null]);
  await sync.close();
});

test('same-size/same-mtime edits are picked up by periodic forced audit', async () => {
  const store = memoryStore(); let text = 'hello'; let reads = 0;
  const sync = new TranscriptSync({ store, intervalMs: 0, auditMs: 0, nativeSessions: { async historySnapshot(id, token) { assert.equal(token, null); reads++; return { changeToken: 'unchanged-metadata', messages: [native('u', 'user', text)] }; } } });
  await sync.syncChat('chat'); text = 'there'; await sync.syncChat('chat');
  assert.equal(reads, 2);
  assert.equal(store.snapshot().chats[0].messages[0].content, 'there');
  await sync.close();
});

test('shutdown cancels an in-flight snapshot without writing the store', async () => {
  const store = memoryStore(); let resolve;
  const sync = new TranscriptSync({ store, intervalMs: 0, nativeSessions: { historySnapshot: () => new Promise(done => { resolve = done; }) } });
  const pending = sync.syncChat('chat');
  const closing = sync.close();
  resolve({ changeToken: 'x', messages: [native('u', 'user', 'new')] });
  await Promise.all([closing, pending]);
  assert.equal(store.writes, 0);
  await sync.tick(); assert.equal(store.writes, 0);
});

test('ambiguous legacy identical turns fail safely; streamed UUID anchors choose the actual turn', () => {
  const source = [native('external-u', 'user', 'same'), native('external-a', 'assistant', 'ok'), native('app-u', 'user', 'same'), native('app-a', 'assistant', 'ok')];
  const saved = [app('x', 'user', 'same'), app('y', 'assistant', 'ok')];
  assert.throws(() => reconcileMessages(saved, source), /saved messages/);
  saved[1].nativeSourceIds = ['app-a'];
  const synced = reconcileMessages(saved, source);
  assert.deepEqual(synced.map(m => m.id), ['external-u', 'external-a', 'x', 'y']);
});

test('unwritten failed local attempts remain anchored but cannot poison future sync', () => {
  const source = [native('u', 'user', 'hello'), native('a', 'assistant', 'done')];
  const base = reconcileMessages([], source);
  const failed = [...base, app('failed-u', 'user', 'never sent'), app('failed-a', 'assistant', '', { status: 'error', error: 'Failed to start Claude' })];
  const synced = reconcileMessages(failed, source);
  assert.equal(synced.length, 4);
  assert.equal(synced[2].appOnly, true); assert.equal(synced[3].appOnly, true);
  assert.deepEqual(reconcileMessages(synced, source), synced);
  const next = [...source, native('cli-u', 'user', 'later'), native('cli-a', 'assistant', 'new')];
  assert.deepEqual(reconcileMessages(synced, next).map(m => m.id), ['u', 'a', 'failed-u', 'failed-a', 'cli-u', 'cli-a']);
});

test('native API usage stays on each record if legacy app has no whole-turn total', () => {
  const source = [native('u', 'user', 'go'), native('a1', 'assistant', 'first'), native('a2', 'assistant', 'second')];
  source[1].usage = { inputTokens: 10, outputTokens: 1, scope: 'apiMessage' };
  source[2].usage = { inputTokens: 20, outputTokens: 2, scope: 'apiMessage' };
  const synced = reconcileMessages([app('x', 'user', 'go'), app('y', 'assistant', 'firstsecond')], source);
  assert.deepEqual(synced.slice(1).map(m => m.usage), source.slice(1).map(m => m.usage));
  assert.deepEqual(reconcileMessages(synced, source), synced);
});

test('forced unstable snapshots fail closed instead of returning stale synced state', async () => {
  const store = memoryStore(); let changing = false;
  const sync = new TranscriptSync({ store, intervalMs: 0, nativeSessions: { async historySnapshot() {
    if (changing) throw Object.assign(new Error('History changed during read'), { statusCode: 409 });
    return { changeToken: 'stable', messages: [native('u', 'user', 'hello')] };
  } } });
  assert.equal(await sync.syncChat('chat'), true);
  changing = true;
  assert.equal(await sync.syncChat('chat', { force: true }), false);
  assert.equal(store.snapshot().chats[0].sync.status, 'error');
  assert.equal(store.snapshot().chats[0].messages.length, 1);
  changing = false;
  assert.equal(await sync.syncChat('chat', { force: true }), true);
  await sync.close();
});

test('failed reads back off, and timeout does not start overlapping reads for the same session', async () => {
  const store = memoryStore(); let reads = 0, resolve;
  const sync = new TranscriptSync({ store, intervalMs: 0, readTimeoutMs: 10, nativeSessions: { historySnapshot() { reads++; return new Promise(done => { resolve = done; }); } } });
  assert.equal(await sync.syncChat('chat'), false);
  assert.equal(await sync.syncChat('chat'), false);
  assert.equal(await sync.syncChat('chat', { force: true }), false);
  assert.equal(reads, 1);
  resolve({ changeToken: 'new', messages: [native('u', 'user', 'done')] });
  await sync.close();
});

test('invalidating cached sync forces a reread even when transcript metadata did not change', async () => {
  const store = memoryStore(); const tokens = [];
  const sync = new TranscriptSync({ store, intervalMs: 0, nativeSessions: { async historySnapshot(id, token) {
    tokens.push(token); return token === 'same' ? null : { changeToken: 'same', messages: [native('u', 'user', 'hi')] };
  } } });
  await sync.syncChat('chat');
  await store.update(state => { delete state.chats[0].sync; });
  assert.equal(await sync.syncChat('chat'), true);
  assert.deepEqual(tokens, [null, null]);
  assert.equal(store.snapshot().chats[0].sync.status, 'synced');
  await sync.close();
});

test('interleaved native records cannot be reordered inside a saved aggregate response', () => {
  const source = [native('u', 'user', 'go'), native('a', 'assistant', 'first'), native('b', 'assistant', 'second')];
  const saved = reconcileMessages([app('x', 'user', 'go'), app('y', 'assistant', 'firstsecond', { usage: { inputTokens: 1, outputTokens: 2 } })], source);
  const interleaved = [source[0], source[1], native('other', 'user', 'another terminal'), source[2]];
  assert.throws(() => reconcileMessages(saved, interleaved), /saved messages/);
});
