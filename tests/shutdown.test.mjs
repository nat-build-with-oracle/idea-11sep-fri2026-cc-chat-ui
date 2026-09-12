import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from '../server/app.mjs';

class ActiveRunner {
  constructor() {
    this.calls = [];
    this.pending = new Map();
  }

  health() {
    return Promise.resolve({ claudeAvailable: true, claudeVersion: 'test' });
  }

  run(options) {
    this.calls.push(options);
    return new Promise((resolve) => {
      this.pending.set(options.chatId, resolve);
      options.onUpdate({ text: 'partial response', tools: [] });
    });
  }

  stop() {
    return Promise.resolve(false);
  }

  async stopAll() {
    for (const resolve of this.pending.values()) {
      resolve({ ok: false, interrupted: true, text: 'partial response', tools: [] });
    }
    this.pending.clear();
  }
}

async function fixture(t, overrides = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-shutdown-'));
  const server = await createServer({ dataDir, cwd: process.cwd(), ...overrides });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  t.after(async () => {
    if (!closed) await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    dataDir,
    origin,
    server,
    async closeHttp() {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  return { response, value: await response.json() };
}

test('app close waits until an active run is interrupted and its final state is persisted', async (t) => {
  const runner = new ActiveRunner();
  const f = await fixture(t, { runner });
  const created = await jsonRequest(`${f.origin}/api/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const sent = await jsonRequest(`${f.origin}/api/chats/${created.value.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'keep the partial response' }),
  });
  assert.equal(sent.response.status, 202);
  assert.equal(runner.calls.length, 1);

  await f.server.app.close();

  const memory = f.server.app.store.snapshot().chats[0];
  assert.equal(memory.status, 'idle');
  assert.equal(memory.messages.at(-1).status, 'interrupted');
  assert.equal(memory.messages.at(-1).content, 'partial response');
  const disk = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).chats[0];
  assert.equal(disk.status, 'idle');
  assert.equal(disk.messages.at(-1).status, 'interrupted');
  assert.equal(disk.messages.at(-1).content, 'partial response');

  await f.closeHttp();
});

test('app close prevents a runner launch after a delayed native ownership check', async (t) => {
  let resumableCalls = 0;
  let releaseRecheck;
  let signalRecheckStarted;
  const recheckStarted = new Promise((resolve) => { signalRecheckStarted = resolve; });
  const delayedRecheck = new Promise((resolve) => { releaseRecheck = resolve; });
  const native = {
    id: 'saved',
    cwd: process.cwd(),
    kind: 'saved',
    name: 'Saved',
    sessionId: 'shutdown-race-session',
    startedAt: 1,
    action: 'resume',
  };
  const nativeSessions = {
    async list() { return [native]; },
    async messages() { return { messages: [], nextOffset: null }; },
    async rename() { return native; },
    async resumable() {
      resumableCalls += 1;
      if (resumableCalls === 3) {
        signalRecheckStarted();
        await delayedRecheck;
      }
      return native;
    },
  };
  const runner = new ActiveRunner();
  const f = await fixture(t, { nativeSessions, runner });
  const imported = await jsonRequest(`${f.origin}/api/native-sessions/${native.sessionId}/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const sent = await jsonRequest(`${f.origin}/api/chats/${imported.value.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'do not launch after shutdown starts' }),
  });
  assert.equal(sent.response.status, 202);
  await recheckStarted;

  const closing = f.server.app.close();
  releaseRecheck(native);
  await closing;

  assert.equal(runner.calls.length, 0);
  const chat = f.server.app.store.snapshot().chats[0];
  assert.equal(chat.status, 'idle');
  assert.equal(chat.messages.at(-1).status, 'interrupted');

  await f.closeHttp();
});

test('shutdown starts sync close and runner stop together and waits for both', async (t) => {
  const runner = new ActiveRunner();
  const f = await fixture(t, { runner });
  const originalClose = f.server.app.transcriptSync.close.bind(f.server.app.transcriptSync);
  await originalClose();
  let releaseSync;
  let releaseRunner;
  const syncClosed = new Promise((resolve) => { releaseSync = resolve; });
  const runnerStopped = new Promise((resolve) => { releaseRunner = resolve; });
  const calls = [];
  f.server.app.transcriptSync.close = () => { calls.push('sync'); return syncClosed; };
  runner.stopAll = () => { calls.push('runner'); return runnerStopped; };
  let settled = false;
  const closing = f.server.app.close().then(() => { settled = true; });
  try {
    assert.deepEqual(calls, ['sync', 'runner']);
    releaseSync();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
  } finally {
    releaseSync();
    releaseRunner();
    await closing;
  }
  assert.equal(settled, true);
  await f.closeHttp();
});
