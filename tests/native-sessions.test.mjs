import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NativeSessionService } from '../server/native-sessions.mjs';

function serviceWith(value, error = null, sdkOverrides = {}) {
  let invocation;
  const sdk = {
    listSessions: async () => [],
    getSessionMessages: async () => [],
    getSessionInfo: async () => undefined,
    renameSession: async () => {},
    ...sdkOverrides,
  };
  const service = new NativeSessionService({ execFileFn(command, args, options, callback) {
    invocation = { command, args, options };
    callback(error, typeof value === 'string' ? value : JSON.stringify(value));
  }, sdk });
  return { service, invocation: () => invocation, sdk };
}

test('native session discovery uses the bounded supported CLI and sanitizes records', async () => {
  const fixture = serviceWith([
    { id: 'a', cwd: process.cwd(), kind: 'interactive', name: 'Live', pid: 42, sessionId: 'live-session', startedAt: 10, status: 'idle', secret: 'drop' },
    { id: 'b', cwd: process.cwd(), kind: 'background', name: 'Done', sessionId: 'done-session', startedAt: 20, state: 'completed' },
    { id: 'invalid', cwd: 'relative', kind: 'background' },
  ]);
  const sessions = await fixture.service.list();
  assert.deepEqual(fixture.invocation().args, ['agents', '--json', '--all']);
  assert.equal(fixture.invocation().options.timeout, 5000);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find((item) => item.id === 'a').action, 'resumeAfterExit');
  assert.equal(sessions.find((item) => item.id === 'a').terminalCommand, "cd '" + process.cwd() + "' && claude --resume 'live-session'");
  assert.equal(sessions.find((item) => item.id === 'b').action, 'resume');
  assert.equal(sessions.find((item) => item.id === 'b').terminalCommand, "cd '" + process.cwd() + "' && claude --resume 'done-session'");
  assert.equal('secret' in sessions[0], false);
});

test('active background sessions expose attach commands while interactive sessions wait for exit', async () => {
  const fixture = serviceWith([
    { id: "job'1", cwd: process.cwd(), kind: 'background', sessionId: 'background-session', state: 'blocked' },
    { id: 'interactive', cwd: process.cwd(), kind: 'interactive', sessionId: 'interactive-session', status: 'busy' },
  ]);
  const sessions = await fixture.service.list();
  assert.equal(sessions[0].action, 'openTerminal');
  assert.equal(sessions[0].terminalCommand, "claude attach 'job'\\''1'");
  assert.equal(sessions[1].action, 'resumeAfterExit');
  assert.match(sessions[1].terminalCommand, /--resume 'interactive-session'$/);
});

test('native session import guard rejects active owners and requires exact full session id', async () => {
  const fixture = serviceWith([
    { id: 'short', cwd: process.cwd(), kind: 'background', sessionId: 'full-id', state: 'working' },
    { id: 'done', cwd: process.cwd(), kind: 'background', sessionId: 'resumable-id', state: 'done' },
  ]);
  await assert.rejects(fixture.service.resumable('full-id'), (error) => error.statusCode === 409);
  await assert.rejects(fixture.service.resumable('short'), (error) => error.statusCode === 404);
  assert.equal((await fixture.service.resumable('resumable-id')).id, 'done');
});

test('native session discovery maps CLI failures and malformed output', async () => {
  assert.deepEqual(await serviceWith([], new Error('missing')).service.list(), []);
  assert.deepEqual(await serviceWith('{bad').service.list(), []);
  const bothFail = serviceWith('{bad', null, { listSessions: async () => { throw new Error('SDK failed'); } });
  await assert.rejects(bothFail.service.list(), (error) => error.statusCode === 502);
});

test('saved sessions become read-only when live ownership inventory is unavailable', async () => {
  const cwd = process.cwd();
  const fixture = serviceWith([], new Error('agents unavailable'), {
    listSessions: async () => [{ sessionId: 'saved', cwd, summary: 'Saved', lastModified: 1 }],
    getSessionMessages: async () => [],
  });
  const session = (await fixture.service.list())[0];
  assert.equal(session.action, 'unavailable');
  assert.equal(session.status, 'liveStatusUnknown');
  await assert.rejects(fixture.service.resumable('saved'), (error) => error.statusCode === 409);
  await assert.rejects(fixture.service.rename('saved', 'Unsafe'), (error) => error.statusCode === 409);
  assert.deepEqual(await fixture.service.messages('saved'), { messages: [], nextOffset: null });
});

test('saved SDK sessions merge with active inventory and active ownership wins', async () => {
  const cwd = process.cwd();
  const fixture = serviceWith([
    { id: 'job', cwd, kind: 'background', sessionId: 'same', state: 'working', startedAt: 20 },
  ], null, {
    listSessions: async (options) => {
      assert.deepEqual(options, { limit: 500, offset: 0, includeProgrammatic: true });
      return [
        { sessionId: 'same', cwd, summary: 'Saved title', createdAt: 10, lastModified: 20 },
        { sessionId: 'saved', cwd, customTitle: 'Historical', createdAt: 30, lastModified: 40 },
      ];
    },
  });
  const sessions = await fixture.service.list();
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find((item) => item.sessionId === 'same').kind, 'background');
  assert.equal(sessions.find((item) => item.sessionId === 'same').action, 'openTerminal');
  assert.equal(sessions.find((item) => item.sessionId === 'same').name, 'Saved title');
  assert.equal(sessions.find((item) => item.sessionId === 'saved').kind, 'saved');
});

test('history is normalized losslessly and paginated with an exact discovered cwd', async () => {
  const cwd = process.cwd();
  let getOptions;
  const fixture = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'history', cwd, summary: 'History', createdAt: 1000, lastModified: 2000 }],
    getSessionMessages: async (id, options) => {
      assert.equal(id, 'history');
      getOptions = options;
      return [
        { type: 'assistant', uuid: 'm1', session_id: id, parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Before ' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file: 'x' } }, { type: 'text', text: ' after' }] } },
        { type: 'user', uuid: 'm2', session_id: id, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }] } },
      ];
    },
  });
  const page = await fixture.service.messages('history', { offset: 4, limit: 1 });
  assert.deepEqual(getOptions, { dir: cwd, offset: 4, limit: 2 });
  assert.equal(page.nextOffset, 5);
  assert.equal(page.messages[0].content, 'Before  after');
  assert.deepEqual(page.messages[0].history.blocks.map((block) => block.type), ['text', 'tool', 'text']);
  assert.equal(page.messages[0].tools[0].name, 'Read');
});

test('history exposes only complete assistant usage and never fabricates missing or partial totals', async () => {
  const cwd = process.cwd();
  const fixture = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'usage-history', cwd, summary: 'Usage', createdAt: 1000 }],
    getSessionMessages: async (id) => [
      { type: 'assistant', uuid: 'partial', session_id: id, parent_tool_use_id: null, message: { id: 'same-api-message', stop_reason: null, usage: { input_tokens: 10, output_tokens: 2 }, content: [{ type: 'text', text: 'partial' }] } },
      { type: 'assistant', uuid: 'complete', session_id: id, parent_tool_use_id: null, message: { id: 'same-api-message', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 80, cache_creation_input_tokens: 7 }, content: [{ type: 'text', text: 'complete' }] } },
      { type: 'assistant', uuid: 'missing', session_id: id, parent_tool_use_id: null, message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'old client' }] } },
      { type: 'assistant', uuid: 'invalid', session_id: id, parent_tool_use_id: null, message: { stop_reason: 'end_turn', usage: { input_tokens: -1, output_tokens: 4 }, content: [{ type: 'text', text: 'bad' }] } },
    ],
  });
  const page = await fixture.service.messages('usage-history', { limit: 20 });
  assert.equal(page.messages[0].usage, undefined);
  assert.deepEqual(page.messages[1].usage, { inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 80, cacheCreationInputTokens: 7, scope: 'apiMessage' });
  assert.equal(page.messages[2].usage, undefined);
  assert.equal(page.messages[3].usage, undefined);
});

test('invalid SDK history shapes are rejected and impossible timestamps are sanitized', async () => {
  const cwd = process.cwd();
  const fixture = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'bad-history', cwd, summary: 'Bad', createdAt: 1e300, lastModified: 1e300 }],
    getSessionMessages: async () => ({ not: 'an array' }),
  });
  assert.equal((await fixture.service.list())[0].startedAt, null);
  await assert.rejects(fixture.service.messages('bad-history'), (error) => error.statusCode === 502);
});

test('rename uses the exact discovered cwd, rejects active owners, and surfaces SDK failure', async () => {
  const cwd = process.cwd();
  let renameArgs;
  let infoArgs;
  const saved = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'saved', cwd, summary: 'Old', lastModified: 1 }],
    renameSession: async (...args) => { renameArgs = args; },
    getSessionInfo: async (...args) => { infoArgs = args; return { sessionId: 'saved', cwd, customTitle: 'Refreshed title', lastModified: 2 }; },
  });
  assert.equal((await saved.service.rename('saved', 'New')).name, 'Refreshed title');
  assert.deepEqual(renameArgs, ['saved', 'New', { dir: cwd }]);
  assert.deepEqual(infoArgs, ['saved', { dir: cwd }]);
  const active = serviceWith([{ id: 'job', cwd, kind: 'background', sessionId: 'active', state: 'working' }]);
  await assert.rejects(active.service.rename('active', 'No'), (error) => error.statusCode === 409);
  const failed = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'saved', cwd, summary: 'Old', lastModified: 1 }],
    renameSession: async () => { throw new Error('write failed'); },
  });
  await assert.rejects(failed.service.rename('saved', 'No'), (error) => error.statusCode === 502);
});

test('an attached interactive record never erases its background agent or active-owner guard', async () => {
  const cwd = process.cwd();
  for (const state of ['blocked', 'done']) {
    const background = { id: 'job-id', cwd, kind: 'background', sessionId: 'shared-session', name: 'Maw', state, startedAt: 10 };
    const terminal = { cwd, kind: 'interactive', sessionId: 'shared-session', name: 'Maw', pid: 42, status: 'idle', startedAt: 20 };
    for (const records of [[background, terminal], [terminal, background]]) {
      const { service } = serviceWith(records);
      const sessions = await service.list();
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].kind, 'background');
      assert.equal(sessions[0].id, 'job-id');
      assert.equal(sessions[0].startedAt, 10);
      assert.equal(sessions[0].state, state);
      assert.equal(sessions[0].pid, 42);
      assert.equal(sessions[0].action, 'resumeAfterExit');
      await assert.rejects(service.resumable('shared-session'), error => error.statusCode === 409);
    }
  }
});


test('native grouping resolves symlink cwd while SDK history uses its original directory', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc-native-alias-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const alias = path.join(directory, 'alias');
  await symlink(process.cwd(), alias, 'dir');
  const fixture = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'alias-session', cwd: alias, summary: 'Alias', createdAt: 1 }],
    getSessionMessages: async (id, options) => { assert.equal(options.dir, alias); return []; },
  });
  const [session] = await fixture.service.list();
  assert.equal(session.cwd, alias);
  assert.equal(session.canonicalPath, await realpath(alias));
  await fixture.service.messages('alias-session');
});
