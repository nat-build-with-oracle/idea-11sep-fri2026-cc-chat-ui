import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from '../server/app.mjs';

async function fixture(t, overrides = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-claude-only-'));
  const calls = [];
  const runner = {
    async health() { return { claudeAvailable: true, claudeVersion: 'test' }; },
    run(input) { calls.push(input); return Promise.resolve({ ok: true, text: 'OK', tools: [] }); },
    async stop(id) { calls.push({ stop: id }); return false; },
    async stopAll() {},
  };
  const source = { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'dummy-official', ZAI_API_KEY: 'dummy-removed', CC_CHAT_CHAT_MODELS: 'glm-5.2' };
  const server = await createServer({ dataDir, runner, environment: source, chatModels: 'glm-5.2', ...overrides });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await server.app.close();
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    server, calls,
    async request(route, input, method = input === undefined ? 'GET' : 'POST') {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, {
        method, headers: { 'content-type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

function savedChat(overrides = {}) {
  return { id: 'legacy', title: 'Keep history', projectId: null, sessionId: null, model: 'glm-5.2', permissionMode: 'default', createdAt: '1', updatedAt: '1', status: 'idle', messages: [{ id: 'm', role: 'user', content: 'keep me' }], ...overrides };
}

test('health and creation expose only Claude even with old GLM configuration', async t => {
  const f = await fixture(t);
  const health = await f.request('/health');
  assert.deepEqual(health.body.chatModels, ['sonnet', 'opus', 'haiku']);
  assert.equal(health.body.providers, undefined);
  assert.doesNotMatch(JSON.stringify(health.body), /dummy-|glm|zai/i);
  for (const model of ['sonnet', 'opus', 'haiku']) {
    const created = await f.request('/chats', { model });
    assert.equal(created.status, 201);
    assert.equal(created.body.model, model);
    assert.equal(created.body.provider, undefined);
  }
  const before = f.server.app.store.snapshot();
  for (const input of [{ model: 'glm-5.2' }, { model: 'glm-5.2[1m]' }, { provider: 'zai', model: 'sonnet' }, { provider: 'unknown' }]) {
    assert.equal((await f.request('/chats', input)).status, 400);
  }
  assert.deepEqual(f.server.app.store.snapshot(), before);
  assert.equal(f.calls.length, 0);
});

test('all legacy non-Claude histories stay readable and cannot send or convert models', async t => {
  const f = await fixture(t);
  for (const chat of [savedChat(), savedChat({ id: 'explicit', provider: 'zai', model: 'sonnet' }), savedChat({ id: 'unknown', model: 'other-model' })]) {
    await f.server.app.store.update(state => { state.chats.push(chat); });
    const before = f.server.app.store.snapshot();
    assert.equal((await f.request(`/chats/${chat.id}/messages`, { content: 'must not launch' })).status, 409);
    assert.equal((await f.request(`/chats/${chat.id}`, { model: 'sonnet' }, 'PATCH')).status, 409);
    assert.equal((await f.request(`/chats/${chat.id}`, { provider: 'claude' }, 'PATCH')).status, 400);
    assert.deepEqual(f.server.app.store.snapshot(), before);
    assert.deepEqual((await f.request('/state')).body.chats.find(item => item.id === chat.id), chat);
  }
  assert.equal(f.calls.length, 0);
});

test('new and old Claude chats launch using only official Claude environment and preserve native auth', async t => {
  const f = await fixture(t);
  for (const chat of [savedChat({ id: 'old-claude', model: 'haiku' }), savedChat({ id: 'explicit-claude', provider: 'claude', model: 'opus' })]) {
    await f.server.app.store.update(state => { state.chats.push(chat); });
    assert.equal((await f.request(`/chats/${chat.id}/messages`, { content: 'hello' })).status, 202);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.env.ANTHROPIC_BASE_URL, 'https://api.anthropic.com');
    assert.equal(call.env.ANTHROPIC_API_KEY, 'dummy-official');
    assert.equal(call.env.ZAI_API_KEY, undefined);
    assert.equal(call.env.CC_CHAT_CHAT_MODELS, undefined);
  }
});

test('native imports reject removed providers before accessing history and cannot reuse a legacy GLM record', async t => {
  let reads = 0;
  const f = await fixture(t, { nativeSessions: {
    async list() { return []; },
    async resumable(sessionId) { reads++; return { sessionId, cwd: process.cwd(), name: 'Native', startedAt: 1 }; },
    async messages() { reads++; return { messages: [], nextOffset: null }; },
  } });
  for (const input of [{ provider: 'zai' }, { model: 'glm-5.2' }]) {
    assert.equal((await f.request('/native-sessions/native/import', input)).status, 400);
  }
  assert.equal(reads, 0);
  const chat = savedChat({ sessionId: 'native' });
  await f.server.app.store.update(state => { state.chats.push(chat); });
  assert.equal((await f.request('/native-sessions/native/import', {})).status, 409);
  assert.equal(reads, 0);
  const imported = await f.request('/native-sessions/claude-native/import', {});
  assert.equal(imported.status, 201);
  assert.equal(imported.body.model, 'sonnet');
  assert.equal(imported.body.provider, undefined);
});

test('removed-provider histories cannot invoke Claude naming or native rename', async t => {
  let calls = 0;
  const f = await fixture(t, {
    sessionNameGenerator: async () => { calls++; return { summary: 'x', suggestions: ['a', 'b', 'c'] }; },
    nativeSessions: { async list() { return []; }, async rename() { calls++; } },
  });
  await f.server.app.store.update(state => { state.chats.push(savedChat({ sessionId: 'old-session' })); });
  const before = f.server.app.store.snapshot();
  assert.equal((await f.request('/session-names/suggest', { target: { kind: 'chat', id: 'legacy' }, summaryModel: 'haiku' })).status, 409);
  assert.equal((await f.request('/chats/legacy', { title: 'new' }, 'PATCH')).status, 409);
  assert.equal(calls, 0);
  assert.deepEqual(f.server.app.store.snapshot(), before);
});

test('native duplicate views cannot bypass the read-only guard or lose its identity', async t => {
  let reads = 0;
  const f = await fixture(t, { nativeSessions: {
    async list() { return [{ id: 'native-old', sessionId: 'native-old', name: 'Old', action: 'resume', terminalCommand: 'claude --resume native-old', existingTerminal: { attachCommand: 'maw a old' } }]; },
    async historySnapshot() { reads++; return { messages: [], changeToken: 'next' }; },
    async messages() { reads++; return { messages: [], nextOffset: null }; },
    async rename() { reads++; },
    async resumable() { reads++; },
    async existingTerminal() { reads++; return { attachCommand: 'maw a old' }; },
  }, syncIntervalMs: 0 });
  await f.server.app.store.update(state => { state.chats.push(savedChat({ sessionId: 'native-old' })); });
  const before = f.server.app.store.snapshot();
  const listed = (await f.request('/native-sessions')).body.sessions[0];
  assert.equal(listed.action, 'unavailable');
  assert.equal(listed.terminalCommand, null);
  assert.equal(listed.existingTerminal, undefined);
  for (const [route, input, method] of [
    ['/native-sessions/native-old/messages', undefined, 'GET'],
    ['/native-sessions/native-old', { title: 'x' }, 'PATCH'],
    ['/session-names/suggest', { target: { kind: 'native', id: 'native-old' }, summaryModel: 'haiku' }, 'POST'],
    ['/session-names/alias', { target: { kind: 'native', id: 'native-old' }, title: 'x', expectedTitle: 'Old' }, 'POST'],
    ['/session-names/alias', { target: { kind: 'chat', id: 'legacy' }, title: 'x', expectedTitle: 'Keep history' }, 'POST'],
    ['/chats/legacy/sync', {}, 'POST'],
    ['/chats/legacy/stop', {}, 'POST'],
    ['/chats/legacy', undefined, 'DELETE'],
  ]) assert.equal((await f.request(route, input, method)).status, 409, route);
  await f.server.app.transcriptSync.tick();
  assert.equal(await f.server.app.transcriptSync.syncChat('legacy', { force: true }), false);
  assert.equal(reads, 0);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.server.app.store.snapshot(), before);
});
