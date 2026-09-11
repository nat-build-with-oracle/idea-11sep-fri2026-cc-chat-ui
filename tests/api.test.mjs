import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from '../server/app.mjs';

class FakeRunner {
  constructor() { this.calls = []; this.pending = new Map(); }
  health() { return Promise.resolve({ claudeAvailable: true, claudeVersion: 'test' }); }
  run(options) {
    this.calls.push(options);
    return new Promise((resolve) => {
      this.pending.set(options.chatId, { resolve, options });
      queueMicrotask(() => options.onUpdate({ sessionId: 'session-1', text: 'working', tools: [] }));
    });
  }
  async stop(chatId) { const entry = this.pending.get(chatId); if (!entry) return false; this.pending.delete(chatId); entry.resolve({ ok: false, interrupted: true, error: 'Interrupted', sessionId: 'session-1', text: 'working', tools: [] }); return true; }
  update(chatId, update) { this.pending.get(chatId)?.options.onUpdate(update); }
  complete(chatId, text = 'done', usage) { const entry = this.pending.get(chatId); this.pending.delete(chatId); entry.resolve({ ok: true, interrupted: false, sessionId: 'session-1', text, tools: [], ...(usage ? { usage } : {}) }); }
  stopAll() { return Promise.resolve(); }
}

async function fixture(overrides = {}) {
  const runner = new FakeRunner();
  const server = await createServer({ dataDir: await mkdtemp(path.join(os.tmpdir(), 'cc-chat-api-')), cwd: process.cwd(), runner, devOrigin: 'http://127.0.0.1:5173', ...overrides });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { runner, server, origin, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const value = response.status === 204 ? null : await response.json();
  return { response, value };
}

function rawHostRequest(origin, host) {
  const url = new URL('/api/state', origin);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

function rawPathRequest(origin, requestPath) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, path: requestPath }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

function openEvents(origin) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${origin}/api/events`, (response) => {
      let content = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        content += chunk;
        if (content.includes('event: state') && content.includes('"chats"')) resolve({ request, response, content: () => content });
      });
    });
    request.once('error', reject);
  });
}

test('API creates chats, runs messages, persists session, prevents concurrent sends and locks project', async (t) => {
  const f = await fixture(); t.after(f.close);
  const state = (await jsonRequest(`${f.origin}/api/state`)).value;
  const projectId = state.projects[0].id;
  const created = await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.value.permissionMode, 'bypassPermissions');
  const id = created.value.id;
  const sent = await jsonRequest(`${f.origin}/api/chats/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
  assert.equal(sent.response.status, 202);
  assert.equal(sent.value.status, 'running');
  assert.equal(f.runner.calls[0].cwd, process.cwd());
  const conflict = await jsonRequest(`${f.origin}/api/chats/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'again' }) });
  assert.equal(conflict.response.status, 409);
  f.runner.complete(id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const finished = (await jsonRequest(`${f.origin}/api/state`)).value.chats[0];
  assert.equal(finished.sessionId, 'session-1');
  assert.equal(finished.messages.at(-1).content, 'done');
  const patch = await jsonRequest(`${f.origin}/api/chats/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
  assert.equal(patch.response.status, 409);
});

test('API persists actual assistant usage returned for the completed turn', async (t) => {
  const f = await fixture(); t.after(f.close);
  const chat = (await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).value;
  await jsonRequest(`${f.origin}/api/chats/${chat.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'measure me' }) });
  const streamedUsage = { inputTokens: 10, outputTokens: 2 };
  f.runner.update(chat.id, { sessionId: 'session-1', text: 'measuring', tools: [], usage: streamedUsage });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const streaming = (await jsonRequest(`${f.origin}/api/state`)).value.chats[0].messages.at(-1);
  assert.deepEqual(streaming.usage, streamedUsage);
  const usage = { inputTokens: 12, outputTokens: 3, cacheReadInputTokens: 40, costUsd: 0.004 };
  f.runner.complete(chat.id, 'measured', usage);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const saved = (await jsonRequest(`${f.origin}/api/state`)).value.chats[0].messages.at(-1);
  assert.deepEqual(saved.usage, usage);
});

test('first-turn project cwd is frozen and cannot be reassigned while running before session init', async (t) => {
  class QuietRunner extends FakeRunner {
    run(options) {
      this.calls.push(options);
      return new Promise((resolve) => this.pending.set(options.chatId, { resolve, options }));
    }
  }
  const runner = new QuietRunner();
  const f = await fixture({ runner }); t.after(f.close);
  const state = (await jsonRequest(`${f.origin}/api/state`)).value;
  const firstProject = state.projects[0];
  const secondPath = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-project-'));
  const secondProject = (await jsonRequest(`${f.origin}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Second', path: secondPath }) })).value;
  const chat = (await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: firstProject.id }) })).value;
  const sent = await jsonRequest(`${f.origin}/api/chats/${chat.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'first turn' }) });
  assert.equal(sent.value.sessionId, null);
  assert.equal(sent.value.status, 'running');
  const changed = await jsonRequest(`${f.origin}/api/chats/${chat.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: secondProject.id }) });
  assert.equal(changed.response.status, 409);
  assert.match(changed.value.error, /while a chat is running/);
  assert.equal(runner.calls[0].cwd, firstProject.path);
  await runner.stop(chat.id);
});

test('native sessions can be listed and only inactive sessions can be imported and resumed', async (t) => {
  let active = false;
  const nativeSessions = {
    list: async () => [{ id: 'short', cwd: process.cwd(), kind: 'background', name: 'Native name', pid: null, sessionId: 'native-full-id', startedAt: 1000, state: 'done', status: null, waitingFor: null, action: 'resume', terminalCommand: "cd '.' && claude --resume 'native-full-id'" }],
    async resumable(id) {
      assert.equal(id, 'native-full-id');
      if (active) throw Object.assign(new Error('Native Claude session is active; use its terminal instead'), { statusCode: 409 });
      return (await this.list())[0];
    },
    async messages(id, options) {
      assert.equal(id, 'native-full-id');
      assert.ok(options.limit <= 200);
      return { messages: [{ id: 'history-message', role: 'user', content: 'earlier', createdAt: new Date(1000).toISOString(), status: 'complete', history: { sourceUuid: 'history-message', parentToolUseId: null, blocks: [{ type: 'text', text: 'earlier' }] } }], nextOffset: null };
    },
    async rename(id, title) { return { ...(await this.list())[0], sessionId: id, name: title }; },
  };
  const f = await fixture({ nativeSessions }); t.after(f.close);
  const listed = await jsonRequest(`${f.origin}/api/native-sessions`);
  assert.equal(listed.value.sessions[0].name, 'Native name');
  const imported = await jsonRequest(`${f.origin}/api/native-sessions/native-full-id/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(imported.response.status, 201);
  assert.equal(imported.value.sessionId, 'native-full-id');
  assert.equal(imported.value.nativeImported, true);
  assert.equal(imported.value.historyUnavailable, false);
  assert.equal(imported.value.title, 'Native name');
  assert.equal(imported.value.messages[0].content, 'earlier');
  const existing = await jsonRequest(`${f.origin}/api/native-sessions/native-full-id/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(existing.response.status, 200);
  const history = await jsonRequest(`${f.origin}/api/native-sessions/native-full-id/messages?offset=0&limit=20`);
  assert.equal(history.value.messages[0].history.sourceUuid, 'history-message');
  const renamed = await jsonRequest(`${f.origin}/api/native-sessions/native-full-id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'New native title' }) });
  assert.equal(renamed.value.chat.title, 'New native title');
  active = true;
  const blocked = await jsonRequest(`${f.origin}/api/chats/${imported.value.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'unsafe concurrent resume' }) });
  assert.equal(blocked.response.status, 409);
  assert.equal(f.runner.calls.length, 0);
  const saved = (await jsonRequest(`${f.origin}/api/state`)).value.chats[0];
  assert.equal(saved.messages.length, 1);
});

test('failed SDK rename leaves app chat title unchanged', async (t) => {
  const nativeSessions = {
    async list() { return [{ id: 'saved', cwd: process.cwd(), kind: 'saved', name: 'Original', sessionId: 'rename-session', startedAt: 1, action: 'resume' }]; },
    async resumable() { return (await this.list())[0]; },
    async messages() { return { messages: [], nextOffset: null }; },
    async rename() { throw Object.assign(new Error('Unable to rename native Claude session'), { statusCode: 502 }); },
  };
  const f = await fixture({ nativeSessions }); t.after(f.close);
  const imported = await jsonRequest(`${f.origin}/api/native-sessions/rename-session/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const failed = await jsonRequest(`${f.origin}/api/chats/${imported.value.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Should not persist' }) });
  assert.equal(failed.response.status, 502);
  const saved = (await jsonRequest(`${f.origin}/api/state`)).value.chats[0];
  assert.equal(saved.title, 'Original');
});

test('API validates projects, content type, host and origin', async (t) => {
  const f = await fixture(); t.after(f.close);
  const badPath = await jsonRequest(`${f.origin}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', path: 'relative' }) });
  assert.equal(badPath.response.status, 400);
  const notJson = await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', body: '{}' });
  assert.equal(notJson.response.status, 415);
  const fakeJson = await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json-evil' }, body: '{}' });
  assert.equal(fakeJson.response.status, 415);
  const origin = await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' });
  assert.equal(origin.response.status, 403);
  const devOrigin = await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' }, body: '{}' });
  assert.equal(devOrigin.response.status, 201);
  const nonObject = await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' });
  assert.equal(nonObject.response.status, 400);
  assert.equal(await rawHostRequest(f.origin, 'evil.example'), 403);
  assert.equal(await rawPathRequest(f.origin, '/api/chats/%E0%A4%A'), 400);
});

test('development Origin override must itself be loopback', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-api-'));
  await assert.rejects(createServer({ dataDir, runner: new FakeRunner(), devOrigin: 'https://evil.example' }), /loopback/);
});

test('stop marks the active assistant interrupted and delete removes only the UI record', async (t) => {
  const f = await fixture(); t.after(f.close);
  const chat = (await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).value;
  await jsonRequest(`${f.origin}/api/chats/${chat.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
  const stopped = await jsonRequest(`${f.origin}/api/chats/${chat.id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(stopped.value.messages.at(-1).status, 'interrupted');
  const removed = await jsonRequest(`${f.origin}/api/chats/${chat.id}`, { method: 'DELETE' });
  assert.equal(removed.response.status, 204);
  assert.equal((await jsonRequest(`${f.origin}/api/state`)).value.chats.length, 0);
});

test('health exposes cwd and injected Claude availability', async (t) => {
  const f = await fixture(); t.after(f.close);
  const result = await jsonRequest(`${f.origin}/api/health`);
  assert.deepEqual(result.value, { ok: true, claudeAvailable: true, claudeVersion: 'test', cwd: process.cwd() });
});

test('SSE sends initial and changed state, and disconnecting does not cancel Claude', async (t) => {
  const f = await fixture(); t.after(f.close);
  const events = await openEvents(f.origin);
  const chat = (await jsonRequest(`${f.origin}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).value;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for changed SSE state')), 1000);
    const check = () => {
      if (events.content().includes(chat.id)) { clearTimeout(timeout); resolve(); }
      else setTimeout(check, 10);
    };
    check();
  });
  await jsonRequest(`${f.origin}/api/chats/${chat.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'continue after disconnect' }) });
  events.response.destroy();
  f.runner.complete(chat.id, 'still completed');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const saved = (await jsonRequest(`${f.origin}/api/state`)).value.chats[0];
  assert.equal(saved.messages.at(-1).content, 'still completed');
  assert.equal(saved.status, 'idle');
});

test('stop during an imported session ownership recheck prevents a late process launch', async (t) => {
  let resumableCalls = 0;
  let releaseRecheck;
  const delayed = new Promise((resolve) => { releaseRecheck = resolve; });
  const native = { id: 'saved', cwd: process.cwd(), kind: 'saved', name: 'Saved', sessionId: 'race-session', startedAt: 1, action: 'resume' };
  const nativeSessions = {
    async list() { return [native]; },
    async messages() { return { messages: [], nextOffset: null }; },
    async rename() { return native; },
    async resumable() {
      resumableCalls += 1;
      if (resumableCalls === 3) await delayed;
      return native;
    },
  };
  const f = await fixture({ nativeSessions }); t.after(f.close);
  const imported = (await jsonRequest(`${f.origin}/api/native-sessions/race-session/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).value;
  const sent = await jsonRequest(`${f.origin}/api/chats/${imported.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'race' }) });
  assert.equal(sent.response.status, 202);
  const stopped = await jsonRequest(`${f.origin}/api/chats/${imported.id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(stopped.value.messages.at(-1).status, 'interrupted');
  releaseRecheck(native);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.runner.calls.length, 0);
});

test('accepted turn keeps its model and permission configuration across delayed native ownership checks', async (t) => {
  let resumableCalls = 0;
  let releaseRecheck;
  const delayed = new Promise((resolve) => { releaseRecheck = resolve; });
  const native = { id: 'saved', cwd: process.cwd(), kind: 'saved', name: 'Saved', sessionId: 'config-session', startedAt: 1, action: 'resume' };
  const nativeSessions = {
    async list() { return [native]; },
    async messages() { return { messages: [], nextOffset: null }; },
    async rename() { return native; },
    async resumable() {
      resumableCalls += 1;
      if (resumableCalls === 3) await delayed;
      return native;
    },
  };
  const runner = new FakeRunner();
  const f = await fixture({ nativeSessions, runner }); t.after(f.close);
  const imported = (await jsonRequest(`${f.origin}/api/native-sessions/config-session/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).value;
  await jsonRequest(`${f.origin}/api/chats/${imported.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'use accepted settings' }) });
  const patched = await jsonRequest(`${f.origin}/api/chats/${imported.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'opus', permissionMode: 'default' }) });
  assert.equal(patched.response.status, 200);
  releaseRecheck(native);
  await new Promise((resolve) => {
    const check = () => runner.calls.length ? resolve() : setTimeout(check, 5);
    check();
  });
  assert.equal(runner.calls[0].model, 'sonnet');
  assert.equal(runner.calls[0].permissionMode, 'bypassPermissions');
  runner.complete(imported.id);
});

test('native history pages persist, dedupe concurrent retries, gate sends, and reject loads while running', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-history-'));
  let pageCalls = 0;
  let finishHistory = false;
  let releasePage;
  const pageGate = new Promise((resolve) => { releasePage = resolve; });
  const native = { id: 'saved', cwd: process.cwd(), kind: 'saved', name: 'History', sessionId: 'history-session', startedAt: 1, action: 'resume' };
  const historical = (id, content) => ({ id, role: 'assistant', content, createdAt: new Date(1000).toISOString(), status: 'complete', history: { sourceUuid: id, parentToolUseId: null, blocks: [{ type: 'text', text: content }] } });
  const nativeSessions = {
    async list() { return [native]; },
    async resumable() { return native; },
    async rename() { return native; },
    async messages(id, { offset }) {
      assert.equal(id, 'history-session');
      if (offset === 0) return { messages: [historical('h1', 'first')], nextOffset: 2 };
      pageCalls += 1;
      if (pageCalls === 1) await pageGate;
      return finishHistory
        ? { messages: [historical('h2', 'second'), historical('h3', 'third')], nextOffset: null }
        : { messages: [historical('h1', 'duplicate'), historical('h2', 'second')], nextOffset: 2 };
    },
  };
  const runner = new FakeRunner();
  const first = await fixture({ dataDir, nativeSessions, runner });
  const imported = (await jsonRequest(`${first.origin}/api/native-sessions/history-session/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).value;
  const blockedSend = await jsonRequest(`${first.origin}/api/chats/${imported.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'too early' }) });
  assert.equal(blockedSend.response.status, 409);
  await first.server.app.store.update((state) => {
    state.chats[0].messages.push({ id: 'app-owned', role: 'user', content: 'legacy local turn', createdAt: new Date(2000).toISOString(), status: 'complete' });
  });
  const loadOptions = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
  const concurrent = [
    jsonRequest(`${first.origin}/api/chats/${imported.id}/history`, loadOptions),
    jsonRequest(`${first.origin}/api/chats/${imported.id}/history`, loadOptions),
  ];
  releasePage();
  await Promise.all(concurrent);
  assert.equal(pageCalls, 1);
  let chat = (await jsonRequest(`${first.origin}/api/state`)).value.chats[0];
  assert.deepEqual(chat.messages.map((message) => message.id), ['h1', 'h2', 'app-owned']);
  await jsonRequest(`${first.origin}/api/chats/${imported.id}/history`, loadOptions);
  chat = (await jsonRequest(`${first.origin}/api/state`)).value.chats[0];
  assert.deepEqual(chat.messages.map((message) => message.id), ['h1', 'h2', 'app-owned']);
  finishHistory = true;
  await jsonRequest(`${first.origin}/api/chats/${imported.id}/history`, loadOptions);
  chat = (await jsonRequest(`${first.origin}/api/state`)).value.chats[0];
  assert.deepEqual(chat.messages.map((message) => message.id), ['h1', 'h2', 'h3', 'app-owned']);
  assert.equal(chat.historyNextOffset, null);
  await first.close();

  const second = await fixture({ dataDir, nativeSessions, runner });
  try {
    const reloaded = (await jsonRequest(`${second.origin}/api/state`)).value.chats[0];
    assert.deepEqual(reloaded.messages.map((message) => message.id), ['h1', 'h2', 'h3', 'app-owned']);
    assert.equal(reloaded.historyTruncated, false);
    await jsonRequest(`${second.origin}/api/chats/${reloaded.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'now safe' }) });
    const whileRunning = await jsonRequest(`${second.origin}/api/chats/${reloaded.id}/history`, loadOptions);
    assert.equal(whileRunning.response.status, 409);
    await runner.stop(reloaded.id);
  } finally {
    await second.close();
  }
});

test('repository discovery is read-only and protected by the existing origin boundary', async (t) => {
  const inventory = { root: '/Code', repositories: [{ id: 'repo-a', name: 'a', path: '/Code/org/a', modifiedAt: 10 }] };
  const f = await fixture({ repositories: { list: async () => inventory } }); t.after(f.close);
  const before = (await jsonRequest(`${f.origin}/api/state`)).value;
  const result = await jsonRequest(`${f.origin}/api/repositories`);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.value, inventory);
  assert.deepEqual((await jsonRequest(`${f.origin}/api/state`)).value, before);
  assert.equal((await jsonRequest(`${f.origin}/api/repositories`, { headers: { origin: 'https://untrusted.example' } })).response.status, 403);
});

test('registering a discovered repository repeatedly keeps its existing project and threads', async (t) => {
  const f = await fixture(); t.after(f.close);
  const original = (await jsonRequest(`${f.origin}/api/state`)).value.projects[0];
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Do not overwrite', path: original.path }) };
  const [first, second] = await Promise.all([jsonRequest(`${f.origin}/api/projects`, options), jsonRequest(`${f.origin}/api/projects`, options)]);
  assert.equal(first.value.id, original.id);
  assert.equal(second.value.name, original.name);
  assert.equal((await jsonRequest(`${f.origin}/api/state`)).value.projects.length, 1);
});


test('project registration deduplicates a symlink alias without changing existing thread IDs', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-alias-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const alias = path.join(directory, 'alias');
  await symlink(process.cwd(), alias, 'dir');
  const f = await fixture({ cwd: alias }); t.after(f.close);
  const original = (await jsonRequest(`${f.origin}/api/state`)).value.projects[0];
  const post = (projectPath) => jsonRequest(`${f.origin}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alias', path: projectPath }) });
  const results = await Promise.all([post(alias), post(await realpath(alias))]);
  assert.ok(results.every(result => result.response.status === 200 && result.value.id === original.id));
  assert.equal((await jsonRequest(`${f.origin}/api/state`)).value.projects.length, 1);
  assert.equal(original.path, alias, 'keep original execution directory for existing projects');
  assert.equal(original.canonicalPath, await realpath(alias));
});

test('imported native threads resume from their exact original cwd after canonical project dedupe', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-resume-alias-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const alias = path.join(directory, 'alias');
  await symlink(process.cwd(), alias, 'dir');
  const native = { id: 'native', sessionId: 'native-alias', cwd: alias, name: 'Alias session', action: 'resume' };
  const nativeSessions = {
    resumable: async () => native,
    messages: async () => ({ messages: [], nextOffset: null }),
  };
  let onLaunch;
  const launched = new Promise(resolve => { onLaunch = resolve; });
  class CwdRunner extends FakeRunner {
    run(options) { onLaunch(options); return super.run(options); }
  }
  const runner = new CwdRunner();
  const f = await fixture({ nativeSessions, runner }); t.after(f.close);
  const original = (await jsonRequest(`${f.origin}/api/state`)).value.projects[0];
  const imported = (await jsonRequest(`${f.origin}/api/native-sessions/native-alias/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).value;
  assert.equal(imported.projectId, original.id);
  await jsonRequest(`${f.origin}/api/chats/${imported.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'resume' }) });
  const launch = await launched;
  await runner.stop(imported.id);
  assert.equal(launch.cwd, alias);
  assert.equal(launch.sessionId, native.sessionId);
});
