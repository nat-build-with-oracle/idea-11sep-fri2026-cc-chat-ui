import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from '../server/app.mjs';

class FakeRunner {
  constructor() { this.calls = []; }
  health() { return Promise.resolve({ claudeAvailable: true, claudeVersion: 'test' }); }
  run(options) { this.calls.push(options); return Promise.resolve({ ok: true, text: '', tools: [] }); }
  stop() { return Promise.resolve(false); }
  stopAll() { return Promise.resolve(); }
}

class FakeNativeSessions {
  constructor() {
    this.sessions = new Map();
    this.calls = [];
    this.error = null;
    this.gates = new Map();
    this.active = false;
  }

  set(sessionId, changeToken, messages) {
    this.sessions.set(sessionId, { changeToken, messages: structuredClone(messages) });
  }

  async historySnapshot(sessionId, previousToken) {
    this.calls.push({ sessionId, previousToken });
    const gate = this.gates.get(sessionId);
    if (gate) {
      gate.entered();
      await gate.wait;
      this.gates.delete(sessionId);
    }
    if (this.error) throw this.error;
    const snapshot = this.sessions.get(sessionId);
    if (!snapshot) throw Object.assign(new Error('Native Claude session not found'), { statusCode: 404 });
    if (previousToken === snapshot.changeToken) return null;
    return structuredClone(snapshot);
  }

  resumable(sessionId) {
    if (this.active) return Promise.reject(Object.assign(new Error('Native Claude session is active; use its terminal instead'), { statusCode: 409 }));
    return Promise.resolve({ sessionId, cwd: process.cwd(), action: 'resume' });
  }

  gate(sessionId) {
    let release;
    let entered;
    const wait = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    this.gates.set(sessionId, { wait, entered });
    return { started, release };
  }
}

function nativeMessage(id, role, content, extras = {}) {
  return {
    id,
    role,
    content,
    createdAt: extras.createdAt || '2026-09-12T00:00:00.000Z',
    status: 'complete',
    ...(extras.tools ? { tools: extras.tools } : {}),
    ...(extras.usage ? { usage: extras.usage } : {}),
    history: { sourceUuid: id, parentToolUseId: null, blocks: extras.blocks || [{ type: 'text', text: content }] },
  };
}

async function startServer({ dataDir, nativeSessions, runner = new FakeRunner(), syncIntervalMs = 0 }) {
  const server = await createServer({ dataDir, cwd: process.cwd(), nativeSessions, runner, syncIntervalMs, syncAuditMs: 60_000 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, runner, origin: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server, eventStreams = []) {
  for (const stream of eventStreams) {
    stream.response.destroy();
    stream.request.destroy();
  }
  await server.app.close();
  await new Promise(resolve => server.close(resolve));
}

function request(origin, requestPath, { method = 'GET', body } = {}) {
  const url = new URL(requestPath, origin);
  const encoded = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        host: url.host,
        ...(encoded ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded) } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, value: text ? JSON.parse(text) : null });
      });
    });
    outgoing.once('error', reject);
    if (encoded) outgoing.write(encoded);
    outgoing.end();
  });
}

function openEvents(origin) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/events', origin);
    const outgoing = http.get({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host: url.host } }, response => {
      let content = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        content += chunk;
        if (content.includes('event: state')) resolve({ request: outgoing, response, content: () => content });
      });
    });
    outgoing.once('error', reject);
  });
}

async function waitFor(check, message, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function createBoundAppChat(server, origin, { id, sessionId, messages }) {
  const created = await request(origin, '/api/chats', { method: 'POST', body: { title: id } });
  assert.equal(created.status, 201);
  await server.app.store.update(state => {
    const chat = state.chats.find(item => item.id === created.value.id);
    chat.sessionId = sessionId;
    chat.messages = structuredClone(messages);
  });
  return created.value.id;
}

test('background transcript sync emits SSE, survives restart, and remains idempotent with usage intact', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-transcript-sync-api-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const native = new FakeNativeSessions();
  const legacyUsage = { inputTokens: 20, outputTokens: 5, costUsd: 0.01, scope: 'cliResult' };
  const nativeUsage = { inputTokens: 8, outputTokens: 3, cacheReadInputTokens: 12, scope: 'apiMessage' };
  const initialSource = [
    nativeMessage('native-legacy-user', 'user', 'legacy question'),
    nativeMessage('native-legacy-reply', 'assistant', 'legacy answer', { usage: { inputTokens: 1, outputTokens: 1, scope: 'apiMessage' } }),
    nativeMessage('native-cli-user', 'user', 'newer CLI question'),
    nativeMessage('native-cli-reply', 'assistant', 'newer CLI reply', { usage: nativeUsage }),
  ];
  native.set('session-main', 'token-1', initialSource);

  const first = await startServer({ dataDir, nativeSessions: native, syncIntervalMs: 20 });
  const events = await openEvents(first.origin);
  const chatId = await createBoundAppChat(first.server, first.origin, {
    id: 'app-created',
    sessionId: 'session-main',
    messages: [
      { id: 'legacy-user', role: 'user', content: 'legacy question', createdAt: '2026-09-11T00:00:00.000Z', status: 'complete' },
      { id: 'legacy-assistant', role: 'assistant', content: 'legacy answer', createdAt: '2026-09-11T00:00:01.000Z', status: 'complete', usage: legacyUsage },
    ],
  });
  await waitFor(() => events.content().includes('native-cli-reply'), 'synced SSE state');
  const synced = await waitFor(async () => {
    const state = (await request(first.origin, '/api/state')).value;
    const chat = state.chats.find(item => item.id === chatId);
    return chat?.messages.length === 4 ? chat : null;
  }, 'background transcript additions');
  assert.deepEqual(synced.messages.map(message => message.content), ['legacy question', 'legacy answer', 'newer CLI question', 'newer CLI reply']);
  assert.deepEqual(synced.messages[1].usage, legacyUsage);
  assert.deepEqual(synced.messages[3].usage, nativeUsage);
  await closeServer(first.server, [events]);

  const extraUsage = { inputTokens: 10, outputTokens: 4, scope: 'apiMessage' };
  native.set('session-main', 'token-2', [
    ...initialSource,
    nativeMessage('native-extra-user', 'user', 'after restart'),
    nativeMessage('native-extra-reply', 'assistant', 'caught up', { usage: extraUsage }),
  ]);
  const second = await startServer({ dataDir, nativeSessions: native, syncIntervalMs: 20 });
  t.after(() => closeServer(second.server));
  const caughtUp = await waitFor(async () => {
    const chat = (await request(second.origin, '/api/state')).value.chats.find(item => item.id === chatId);
    return chat?.messages.length === 6 ? chat : null;
  }, 'restart catch-up');
  assert.deepEqual(caughtUp.messages.at(-1).usage, extraUsage);
  const before = structuredClone(caughtUp.messages);
  await second.server.app.transcriptSync.syncChat(chatId);
  await second.server.app.transcriptSync.syncChat(chatId);
  const repeated = (await request(second.origin, '/api/state')).value.chats.find(item => item.id === chatId);
  assert.deepEqual(repeated.messages, before);
  assert.equal(new Set(repeated.messages.map(message => message.id)).size, repeated.messages.length);
});

test('sync errors preserve cached messages and a later snapshot recovers', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-transcript-sync-error-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const native = new FakeNativeSessions();
  native.set('session-error', 'token-1', [nativeMessage('source-user', 'user', 'cached')]);
  const f = await startServer({ dataDir, nativeSessions: native });
  t.after(() => closeServer(f.server));
  const chatId = await createBoundAppChat(f.server, f.origin, {
    id: 'error-recovery', sessionId: 'session-error',
    messages: [{ id: 'cached-user', role: 'user', content: 'cached', createdAt: '2026-09-11T00:00:00.000Z', status: 'complete' }],
  });
  await f.server.app.transcriptSync.syncChat(chatId, { force: true });
  const cached = structuredClone(f.server.app.store.snapshot().chats.find(chat => chat.id === chatId).messages);
  native.error = Object.assign(new Error('temporary SDK failure'), { statusCode: 502 });
  await f.server.app.transcriptSync.syncChat(chatId, { force: true });
  let chat = f.server.app.store.snapshot().chats.find(item => item.id === chatId);
  assert.deepEqual(chat.messages, cached);
  assert.equal(chat.sync.status, 'error');
  native.error = null;
  native.set('session-error', 'token-2', [
    nativeMessage('source-user', 'user', 'cached'),
    nativeMessage('recovered-reply', 'assistant', 'recovered'),
  ]);
  await f.server.app.transcriptSync.syncChat(chatId, { force: true });
  chat = f.server.app.store.snapshot().chats.find(item => item.id === chatId);
  assert.deepEqual(chat.messages.map(message => message.content), ['cached', 'recovered']);
  assert.equal(chat.sync.status, 'synced');
});

test('an in-flight sync cannot overwrite a running app update or resurrect a deleted chat', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-transcript-sync-races-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const native = new FakeNativeSessions();
  native.set('session-running', 'token-1', [nativeMessage('running-source', 'user', 'base')]);
  native.set('session-delete', 'token-1', [nativeMessage('delete-source', 'user', 'base')]);
  const f = await startServer({ dataDir, nativeSessions: native });
  t.after(() => closeServer(f.server));
  const runningId = await createBoundAppChat(f.server, f.origin, {
    id: 'running-race', sessionId: 'session-running',
    messages: [{ id: 'running-app', role: 'user', content: 'base', createdAt: '2026-09-11T00:00:00.000Z', status: 'complete' }],
  });
  const deleteId = await createBoundAppChat(f.server, f.origin, {
    id: 'delete-race', sessionId: 'session-delete',
    messages: [{ id: 'delete-app', role: 'user', content: 'base', createdAt: '2026-09-11T00:00:00.000Z', status: 'complete' }],
  });
  await f.server.app.transcriptSync.syncChat(runningId, { force: true });
  await f.server.app.transcriptSync.syncChat(deleteId, { force: true });

  native.set('session-running', 'token-2', [nativeMessage('running-source', 'user', 'base'), nativeMessage('late-native', 'assistant', 'must not overwrite')]);
  const runningGate = native.gate('session-running');
  const runningSync = f.server.app.transcriptSync.syncChat(runningId, { force: true });
  await runningGate.started;
  await f.server.app.store.update(state => {
    const chat = state.chats.find(item => item.id === runningId);
    chat.status = 'running';
    chat.messages.push({ id: 'live-user', role: 'user', content: 'live app update', createdAt: '2026-09-12T01:00:00.000Z', status: 'complete' });
  });
  runningGate.release();
  await runningSync;
  const running = f.server.app.store.snapshot().chats.find(item => item.id === runningId);
  assert.equal(running.status, 'running');
  assert.equal(running.messages.at(-1).content, 'live app update');
  assert.equal(running.messages.some(message => message.id === 'late-native'), false);

  native.set('session-delete', 'token-2', [nativeMessage('delete-source', 'user', 'base'), nativeMessage('deleted-native', 'assistant', 'must not resurrect')]);
  const deleteGate = native.gate('session-delete');
  const deleteSync = f.server.app.transcriptSync.syncChat(deleteId, { force: true });
  await deleteGate.started;
  const removed = await request(f.origin, `/api/chats/${deleteId}`, { method: 'DELETE' });
  assert.equal(removed.status, 204);
  deleteGate.release();
  await deleteSync;
  assert.equal(f.server.app.store.snapshot().chats.some(chat => chat.id === deleteId), false);
});

test('sending to an app-created bound session rechecks native ownership before runner launch', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-transcript-sync-active-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const native = new FakeNativeSessions();
  native.set('session-active', 'token-1', []);
  native.active = true;
  const runner = new FakeRunner();
  const f = await startServer({ dataDir, nativeSessions: native, runner });
  t.after(() => closeServer(f.server));
  const chatId = await createBoundAppChat(f.server, f.origin, { id: 'active-owner', sessionId: 'session-active', messages: [] });
  const response = await request(f.origin, `/api/chats/${chatId}/messages`, { method: 'POST', body: { content: 'do not launch' } });
  assert.equal(response.status, 409);
  assert.match(response.value.error, /active/);
  assert.equal(runner.calls.length, 0);
  assert.deepEqual(f.server.app.store.snapshot().chats.find(chat => chat.id === chatId).messages, []);
});

test('a failed post-accept ownership recheck stays app-only and does not poison a later send', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-transcript-sync-launch-race-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const native = new FakeNativeSessions();
  native.set('session-launch-race', 'token-1', []);
  let ownershipChecks = 0;
  let rejectRecheck = true;
  native.resumable = async sessionId => {
    ownershipChecks += 1;
    if (rejectRecheck && ownershipChecks === 2) throw Object.assign(new Error('Native Claude session became active'), { statusCode: 409 });
    return { sessionId, cwd: process.cwd(), action: 'resume' };
  };
  const runner = new FakeRunner();
  const f = await startServer({ dataDir, nativeSessions: native, runner });
  t.after(() => closeServer(f.server));
  const chatId = await createBoundAppChat(f.server, f.origin, { id: 'launch-race', sessionId: 'session-launch-race', messages: [] });

  const accepted = await request(f.origin, `/api/chats/${chatId}/messages`, { method: 'POST', body: { content: 'failed attempt' } });
  assert.equal(accepted.status, 202);
  const failed = await waitFor(() => {
    const chat = f.server.app.store.snapshot().chats.find(item => item.id === chatId);
    return chat?.status === 'idle' ? chat : null;
  }, 'post-accept ownership failure');
  assert.equal(runner.calls.length, 0);
  assert.deepEqual(failed.messages.map(message => [message.role, message.appOnly, message.status]), [
    ['user', true, 'complete'],
    ['assistant', true, 'error'],
  ]);

  rejectRecheck = false;
  const later = await request(f.origin, `/api/chats/${chatId}/messages`, { method: 'POST', body: { content: 'later attempt' } });
  assert.equal(later.status, 202);
  await waitFor(() => runner.calls.length === 1, 'later runner launch');
  const saved = await waitFor(() => {
    const chat = f.server.app.store.snapshot().chats.find(item => item.id === chatId);
    return chat?.status === 'idle' ? chat : null;
  }, 'later runner completion');
  assert.equal(saved.messages[0].content, 'failed attempt');
  assert.equal(saved.messages[0].appOnly, true);
  assert.equal(saved.messages[1].appOnly, true);
  assert.equal(saved.messages.at(-2).content, 'later attempt');
});

test('a forced transient snapshot conflict invalidates prior sync and blocks sends', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-transcript-sync-conflict-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const native = new FakeNativeSessions();
  native.set('session-conflict', 'token-1', []);
  const runner = new FakeRunner();
  const f = await startServer({ dataDir, nativeSessions: native, runner });
  t.after(() => closeServer(f.server));
  const chatId = await createBoundAppChat(f.server, f.origin, { id: 'conflict', sessionId: 'session-conflict', messages: [] });
  assert.equal(await f.server.app.transcriptSync.syncChat(chatId, { force: true }), true);
  assert.equal(f.server.app.store.snapshot().chats.find(chat => chat.id === chatId).sync.status, 'synced');

  native.error = Object.assign(new Error('Native Claude session changed while history was being read'), { statusCode: 409, transient: true });
  const blocked = await request(f.origin, `/api/chats/${chatId}/messages`, { method: 'POST', body: { content: 'unsafe send' } });
  assert.equal(blocked.status, 409);
  assert.match(blocked.value.error, /Resolve the Claude history sync error/);
  assert.equal(runner.calls.length, 0);
  let chat = f.server.app.store.snapshot().chats.find(item => item.id === chatId);
  assert.equal(chat.sync.status, 'error');
  assert.match(chat.sync.error, /changed while history was being read/);

  const manual = await request(f.origin, `/api/chats/${chatId}/sync`, { method: 'POST', body: {} });
  assert.equal(manual.status, 200);
  assert.equal(manual.value.sync.status, 'error');
  assert.match(manual.value.sync.error, /changed while history was being read/);
  chat = f.server.app.store.snapshot().chats.find(item => item.id === chatId);
  assert.deepEqual(chat.messages, []);
  assert.equal(runner.calls.length, 0);
});

test('an accepted web turn clears stale sync and persists streamed and final native source UUIDs', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-transcript-sync-source-ids-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const native = new FakeNativeSessions();
  native.set('session-source-ids', 'token-1', []);
  let finish;
  const runner = new FakeRunner();
  runner.run = options => {
    runner.calls.push(options);
    queueMicrotask(() => options.onUpdate({
      sessionId: 'session-source-ids', text: 'streamed', tools: [], sourceUuids: ['assistant-stream-record'],
    }));
    return new Promise(resolve => { finish = resolve; });
  };
  const f = await startServer({ dataDir, nativeSessions: native, runner });
  t.after(() => closeServer(f.server));
  const chatId = await createBoundAppChat(f.server, f.origin, { id: 'source-ids', sessionId: 'session-source-ids', messages: [] });
  await f.server.app.store.update(state => {
    state.chats.find(chat => chat.id === chatId).sync = { status: 'error', checkedAt: 'old', error: 'stale' };
  });

  const accepted = await request(f.origin, `/api/chats/${chatId}/messages`, { method: 'POST', body: { content: 'capture IDs' } });
  assert.equal(accepted.status, 202);
  assert.equal('sync' in accepted.value, false);
  const streaming = await waitFor(() => {
    const chat = f.server.app.store.snapshot().chats.find(item => item.id === chatId);
    return chat?.messages.at(-1)?.nativeSourceIds ? chat : null;
  }, 'stream source UUID persistence');
  assert.equal('sync' in streaming, false);
  assert.deepEqual(streaming.messages.at(-1).nativeSourceIds, ['assistant-stream-record']);

  finish({
    ok: true,
    sessionId: 'session-source-ids',
    text: 'complete',
    tools: [],
    sourceUuids: ['assistant-final-record', 'tool-result-record'],
  });
  const completed = await waitFor(() => {
    const chat = f.server.app.store.snapshot().chats.find(item => item.id === chatId);
    return chat?.status === 'idle' ? chat : null;
  }, 'final source UUID persistence');
  assert.equal('sync' in completed, false);
  assert.deepEqual(completed.messages.at(-1).nativeSourceIds, ['assistant-final-record', 'tool-result-record']);
});
