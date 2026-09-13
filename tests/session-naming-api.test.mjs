import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from '../server/app.mjs';
import { SessionNamingService } from '../server/session-naming.mjs';

class FakeRunner {
  async health() { return { claudeAvailable: true, claudeVersion: 'test' }; }
  async stopAll() {}
}

async function fixture(overrides = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-session-naming-api-'));
  const server = await createServer({
    dataDir,
    cwd: process.cwd(),
    runner: new FakeRunner(),
    devOrigin: 'http://127.0.0.1:5173',
    ...overrides,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    server,
    async close() {
      await server.app.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function request(origin, pathname, body, method = 'POST') {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, value: await response.json() };
}

function chat(id, { title = 'Original title', sessionId = null, messages = [] } = {}) {
  return {
    id, title, projectId: null, sessionId, model: 'sonnet', permissionMode: 'default',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    messages, status: 'idle',
  };
}

test('health advertises Claude naming capability', async (t) => {
  const f = await fixture({ sessionNameGenerator: async () => ({ summary: 'x', suggestions: ['a', 'b', 'c'] }) });
  t.after(() => f.close());
  const result = await request(f.origin, '/api/health', undefined, 'GET');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.value.sessionNaming, {
    summaryModels: ['haiku', 'sonnet'], namingModel: 'opus',
  });
});

test('chat suggestion reads bounded text only and never mutates stored transcripts or identifiers', async (t) => {
  let generatorInput;
  const nativeCalls = { list: 0, messages: 0, rename: 0 };
  const f = await fixture({
    nativeSessions: {
      async list() { nativeCalls.list += 1; return []; },
      async messages() { nativeCalls.messages += 1; throw new Error('native history must not be read'); },
      async rename() { nativeCalls.rename += 1; throw new Error('native rename must not run'); },
    },
    sessionNameGenerator: async (input) => {
      generatorInput = input;
      return { summary: 'A summary', suggestions: ['Title one', 'Title two', 'Title three'] };
    },
  });
  t.after(() => f.close());
  await f.server.app.store.update((state) => {
    state.chats.push(chat('chat-id', {
      messages: [
        { id: 'message-id', role: 'user', content: `head ${'a'.repeat(30_000)}`, status: 'complete', tools: [{ input: { secret: 'tool payload' } }] },
        { id: 'assistant-id', role: 'assistant', content: 'tail marker', status: 'complete' },
      ],
    }));
  });
  const before = f.server.app.store.snapshot();

  const result = await request(f.origin, '/api/session-names/suggest', {
    target: { kind: 'chat', id: 'chat-id' }, summaryModel: 'haiku',
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.value, {
    summary: 'A summary', suggestions: ['Title one', 'Title two', 'Title three'],
    summaryModel: 'haiku', namingModel: 'opus', truncated: true, messageCount: 2,
  });
  assert.ok(generatorInput.transcript.length <= 24_000);
  assert.match(generatorInput.transcript, /^USER:\nhead/);
  assert.match(generatorInput.transcript, /ASSISTANT:\ntail marker$/);
  assert.doesNotMatch(generatorInput.transcript, /message-id|assistant-id|tool payload/);
  assert.deepEqual(generatorInput.context, { kind: 'chat', model: 'sonnet' });
  assert.deepEqual(f.server.app.store.snapshot(), before);
  assert.deepEqual(nativeCalls, { list: 0, messages: 0, rename: 0 });
});

test('native suggestion reads at most 200 messages and reports source truncation', async (t) => {
  const calls = { messages: 0, rename: 0 };
  let generatorInput;
  const f = await fixture({
    nativeSessions: {
      async list() { return []; },
      async messages(id, options) {
        calls.messages += 1;
        assert.equal(id, 'native-id');
        assert.deepEqual(options, { offset: 0, limit: 200 });
        return {
          messages: Array.from({ length: 200 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index}` })),
          nextOffset: 200,
        };
      },
      async rename() { calls.rename += 1; },
    },
    sessionNameGenerator: async (input) => {
      generatorInput = input;
      return { summary: 'Native summary', suggestions: ['Native one', 'Native two', 'Native three'] };
    },
  });
  t.after(() => f.close());

  const result = await request(f.origin, '/api/session-names/suggest', {
    target: { kind: 'native', id: 'native-id' }, summaryModel: 'sonnet',
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.value.messageCount, 200);
  assert.equal(result.value.truncated, true);
  assert.equal(generatorInput.sourceTruncated, undefined);
  assert.deepEqual(generatorInput.context, { kind: 'native', model: 'sonnet' });
  assert.deepEqual(calls, { messages: 1, rename: 0 });
});

test('chat suggestion reports incomplete imported history as truncated even for short text', async (t) => {
  let generatorInput;
  const f = await fixture({
    sessionNameGenerator: async (input) => {
      generatorInput = input;
      return { summary: 'Partial summary', suggestions: ['Partial one', 'Partial two', 'Partial three'] };
    },
  });
  t.after(() => f.close());
  await f.server.app.store.update((state) => {
    const partial = chat('partial-chat', { messages: [{ id: 'one', role: 'user', content: 'short text' }] });
    partial.nativeImported = true;
    partial.historyTruncated = false;
    partial.historyUnavailable = true;
    partial.historyNextOffset = 100;
    state.chats.push(partial);
  });

  const result = await request(f.origin, '/api/session-names/suggest', {
    target: { kind: 'chat', id: 'partial-chat' }, summaryModel: 'haiku',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.value.truncated, true);
  assert.equal(generatorInput.truncated, true);
});

test('alias endpoint atomically deduplicates native aliases and updates every imported chat without SDK mutation', async (t) => {
  const calls = { list: 0, rename: 0 };
  const native = { sessionId: 'native-id', name: '', cwd: process.cwd(), action: 'resume' };
  const f = await fixture({
    nativeSessions: {
      async list() { calls.list += 1; return [native]; },
      async messages() { throw new Error('history must not be read'); },
      async rename() { calls.rename += 1; throw new Error('native rename must not run'); },
    },
    sessionNameGenerator: async () => ({ summary: 'x', suggestions: ['a', 'b', 'c'] }),
  });
  t.after(() => f.close());
  await f.server.app.store.update((state) => {
    state.chats.push(
      chat('chat-one', { sessionId: 'native-id', messages: [{ id: 'preserved-one', role: 'user', content: 'one' }] }),
      chat('chat-two', { sessionId: 'native-id', messages: [{ id: 'preserved-two', role: 'assistant', content: 'two' }] }),
    );
    state.nativeSessionAliases.push(
      { sessionId: 'native-id', title: 'stale duplicate', updatedAt: '1' },
      { sessionId: 'native-id', title: '', updatedAt: '2' },
    );
  });

  const result = await request(f.origin, '/api/session-names/alias', {
    target: { kind: 'native', id: 'native-id' }, title: 'Chosen title', expectedTitle: '',
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.value, { title: 'Chosen title' });
  const snapshot = f.server.app.store.snapshot();
  assert.deepEqual(snapshot.nativeSessionAliases.filter((alias) => alias.sessionId === 'native-id').map((alias) => alias.title), ['Chosen title']);
  assert.deepEqual(snapshot.chats.map(({ title, messages }) => ({ title, ids: messages.map((message) => message.id) })), [
    { title: 'Chosen title', ids: ['preserved-one'] },
    { title: 'Chosen title', ids: ['preserved-two'] },
  ]);
  assert.deepEqual(calls, { list: 1, rename: 0 });

  const stale = await request(f.origin, '/api/session-names/alias', {
    target: { kind: 'native', id: 'native-id' }, title: 'Late title', expectedTitle: '',
  });
  assert.equal(stale.response.status, 409);
  assert.deepEqual(f.server.app.store.snapshot(), snapshot);
  assert.equal(calls.rename, 0);
});

test('chat alias with a session id remains store-only and rejects stale writes', async (t) => {
  const calls = { list: 0, rename: 0 };
  const f = await fixture({
    nativeSessions: {
      async list() { calls.list += 1; return []; },
      async messages() { throw new Error('history must not be read'); },
      async rename() { calls.rename += 1; throw new Error('native rename must not run'); },
    },
    sessionNameGenerator: async () => ({ summary: 'x', suggestions: ['a', 'b', 'c'] }),
  });
  t.after(() => f.close());
  await f.server.app.store.update((state) => state.chats.push(chat('chat-id', {
    title: 'Before', sessionId: 'session-id', messages: [{ id: 'kept-id', role: 'user', content: 'kept' }],
  })));

  const result = await request(f.origin, '/api/session-names/alias', {
    target: { kind: 'chat', id: 'chat-id' }, title: 'After', expectedTitle: 'Before',
  });
  assert.equal(result.response.status, 200);
  const snapshot = f.server.app.store.snapshot();
  assert.equal(snapshot.chats[0].title, 'After');
  assert.equal(snapshot.chats[0].messages[0].id, 'kept-id');
  assert.deepEqual(snapshot.nativeSessionAliases.map(({ sessionId, title }) => ({ sessionId, title })), [{ sessionId: 'session-id', title: 'After' }]);
  assert.deepEqual(calls, { list: 0, rename: 0 });

  const stale = await request(f.origin, '/api/session-names/alias', {
    target: { kind: 'chat', id: 'chat-id' }, title: 'Too late', expectedTitle: 'Before',
  });
  assert.equal(stale.response.status, 409);
  assert.deepEqual(f.server.app.store.snapshot(), snapshot);
});

test('suggestion validation and global concurrency fail closed', async (t) => {
  let start;
  let release;
  const started = new Promise((resolve) => { start = resolve; });
  const service = new SessionNamingService({
    generateFn: () => new Promise((resolve) => {
      release = () => resolve({ summary: 'Summary', suggestions: ['One', 'Two', 'Three'] });
      start();
    }),
  });
  const f = await fixture({ sessionNaming: service });
  t.after(() => f.close());
  await f.server.app.store.update((state) => state.chats.push(chat('chat-id', {
    messages: [{ id: 'one', role: 'user', content: 'hello' }],
  })));

  const invalid = await request(f.origin, '/api/session-names/suggest', {
    target: { kind: 'repository', id: 'chat-id' }, summaryModel: 'haiku',
  });
  assert.equal(invalid.response.status, 400);
  const first = request(f.origin, '/api/session-names/suggest', {
    target: { kind: 'chat', id: 'chat-id' }, summaryModel: 'haiku',
  });
  await started;
  const concurrent = await request(f.origin, '/api/session-names/suggest', {
    target: { kind: 'chat', id: 'chat-id' }, summaryModel: 'sonnet',
  });
  assert.equal(concurrent.response.status, 409);
  release();
  assert.equal((await first).response.status, 200);
});

test('aborting the HTTP request cancels its naming job and releases the global slot', async (t) => {
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let calls = 0;
  const service = new SessionNamingService({
    generateFn: ({ signal }) => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ summary: 'Recovered', suggestions: ['One', 'Two', 'Three'] });
      startedResolve();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('cancelled'), { statusCode: 503 }));
      }, { once: true }));
    },
  });
  const f = await fixture({ sessionNaming: service });
  t.after(() => f.close());
  await f.server.app.store.update((state) => state.chats.push(chat('chat-id', {
    messages: [{ id: 'one', role: 'user', content: 'hello' }],
  })));

  const controller = new AbortController();
  const pending = fetch(`${f.origin}/api/session-names/suggest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target: { kind: 'chat', id: 'chat-id' }, summaryModel: 'haiku' }),
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(pending, /abort/i);
  while (service.active) await new Promise((resolve) => setImmediate(resolve));

  const recovered = await request(f.origin, '/api/session-names/suggest', {
    target: { kind: 'chat', id: 'chat-id' }, summaryModel: 'sonnet',
  });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.value.summary, 'Recovered');
});
