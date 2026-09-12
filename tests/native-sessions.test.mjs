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
  assert.equal(sessions.find((item) => item.sessionId === 'same').updatedAt, 20);
  assert.equal(sessions.find((item) => item.sessionId === 'saved').kind, 'saved');
  assert.equal(sessions.find((item) => item.sessionId === 'saved').updatedAt, 40);
});

test('history is normalized losslessly and paginated without trusting an active cwd', async () => {
  const cwd = process.cwd();
  let getOptions;
  const fixture = serviceWith([
    { id: 'live', cwd, kind: 'interactive', sessionId: 'history', status: 'idle' },
  ], null, {
    listSessions: async () => [{ sessionId: 'history', cwd: '/opt/black-oracle', summary: 'History', createdAt: 1000, lastModified: 2000 }],
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
  assert.deepEqual(getOptions, { offset: 4, limit: 2 });
  assert.equal(page.nextOffset, 5);
  assert.equal(page.messages[0].content, 'Before  after');
  assert.deepEqual(page.messages[0].history.blocks.map((block) => block.type), ['text', 'tool', 'text']);
  assert.equal(page.messages[0].tools[0].name, 'Read');
});

test('history presents Claude slash-command envelopes as the command the user entered', async () => {
  const cwd = process.cwd();
  const fixture = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'commands', cwd, summary: 'Commands', createdAt: 1000 }],
    getSessionMessages: async () => [{
      type: 'user', uuid: 'command-record', session_id: 'commands', parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: '<command-name>/list-agents</command-name>\n<command-message>list-agents</command-message>\n<command-args></command-args>' }] },
    }],
  });
  const page = await fixture.service.messages('commands');
  assert.equal(page.messages[0].content, '/list-agents');
  assert.equal(page.messages[0].history.blocks[0].text.includes('<command-name>'), true);
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


test('native grouping resolves symlink cwd while SDK history remains unscoped', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc-native-alias-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const alias = path.join(directory, 'alias');
  await symlink(process.cwd(), alias, 'dir');
  const fixture = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'alias-session', cwd: alias, summary: 'Alias', createdAt: 1 }],
    getSessionMessages: async (id, options) => { assert.deepEqual(options, { offset: 0, limit: 101 }); return []; },
  });
  const [session] = await fixture.service.list();
  assert.equal(session.cwd, alias);
  assert.equal(session.canonicalPath, await realpath(alias));
  await fixture.service.messages('alias-session');
});

test('history timestamps prefer transcript record metadata over nested message metadata', async () => {
  const fixture = serviceWith([], null, {
    listSessions: async () => [{ sessionId: 'timestamps', cwd: process.cwd(), summary: 'Times', createdAt: 1 }],
    getSessionMessages: async () => [{
      type: 'user', uuid: 'timestamped', session_id: 'timestamps', parent_tool_use_id: null,
      timestamp: '2026-09-11T12:34:56.000Z',
      message: { timestamp: '2020-01-01T00:00:00.000Z', content: 'hello' },
    }],
  });
  const page = await fixture.service.messages('timestamps');
  assert.equal(page.messages[0].createdAt, '2026-09-11T12:34:56.000Z');
});

test('history snapshots skip the full read when the metadata token is unchanged', async () => {
  let messageReads = 0;
  const info = { sessionId: 'snapshot', summary: 'Snapshot', cwd: '/opt/black-oracle', lastModified: 12, fileSize: 34, createdAt: 1 };
  const fixture = serviceWith([], null, {
    getSessionInfo: async (...args) => { assert.deepEqual(args, ['snapshot']); return info; },
    getSessionMessages: async () => { messageReads += 1; return []; },
  });
  const first = await fixture.service.historySnapshot('snapshot');
  assert.equal(messageReads, 1);
  assert.deepEqual(first, { changeToken: '[12,34,"/opt/black-oracle"]', messages: [] });
  assert.equal(await fixture.service.historySnapshot('snapshot', first.changeToken), null);
  assert.equal(messageReads, 1);
});

test('changed history snapshots return the latest fully normalized transcript', async () => {
  const info = { sessionId: 'snapshot', summary: 'Snapshot', cwd: '/new/project', lastModified: 13, fileSize: 50, createdAt: 1000 };
  const fixture = serviceWith([], null, {
    getSessionInfo: async () => info,
    getSessionMessages: async (...args) => {
      assert.deepEqual(args, ['snapshot', { limit: 10_001 }]);
      return [
        { type: 'assistant', uuid: 'a', session_id: 'snapshot', parent_tool_use_id: null, timestamp: '2026-09-12T00:00:00Z', message: { stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3 }, content: [{ type: 'tool_use', id: 'tool', name: 'Read', input: { file: 'x' } }] } },
        { type: 'system', uuid: 'ignored', session_id: 'snapshot', parent_tool_use_id: null, message: {} },
      ];
    },
  });
  const result = await fixture.service.historySnapshot('snapshot', 'old-token');
  assert.equal(result.changeToken, '[13,50,"/new/project"]');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].tools[0].name, 'Read');
  assert.deepEqual(result.messages[0].usage, { inputTokens: 2, outputTokens: 3, scope: 'apiMessage' });
  assert.equal(result.messages[0].createdAt, '2026-09-12T00:00:00.000Z');
});

test('history snapshots distinguish missing sessions and SDK failures from empty history', async () => {
  await assert.rejects(serviceWith([], null, { getSessionInfo: async () => undefined }).service.historySnapshot('missing'), error => error.statusCode === 404);
  await assert.rejects(serviceWith([], null, { getSessionInfo: async () => { throw new Error('metadata failed'); } }).service.historySnapshot('failed'), error => error.statusCode === 502);
  await assert.rejects(serviceWith([], null, {
    getSessionInfo: async () => ({ sessionId: 'failed', summary: 'x', lastModified: 1 }),
    getSessionMessages: async () => { throw new Error('history failed'); },
  }).service.historySnapshot('failed'), error => error.statusCode === 502);
});

test('history snapshots reject over-limit transcripts instead of returning partial data', async () => {
  let infoReads = 0;
  const fixture = serviceWith([], null, {
    getSessionInfo: async () => { infoReads += 1; return { sessionId: 'large', summary: 'Large', lastModified: 1, fileSize: 2 }; },
    getSessionMessages: async () => Array.from({ length: 10_001 }, (_, index) => ({ type: 'user', uuid: `m${index}`, session_id: 'large', parent_tool_use_id: null, message: { content: '' } })),
  });
  await assert.rejects(fixture.service.historySnapshot('large'), error => error.statusCode === 413 && /safe snapshot limit/.test(error.message));
  assert.equal(infoReads, 1);
});

test('history snapshots reject a transcript that changes during the read with a transient conflict', async () => {
  let infoReads = 0;
  const fixture = serviceWith([], null, {
    getSessionInfo: async () => ({ sessionId: 'moving', summary: 'Moving', cwd: '/project', lastModified: ++infoReads, fileSize: 10 }),
    getSessionMessages: async () => [],
  });
  await assert.rejects(fixture.service.historySnapshot('moving'), error => error.statusCode === 409 && error.transient === true);
  assert.equal(infoReads, 2);
});

test('idle interactive ownership explains the still-open terminal and PID', async () => {
  const { service } = serviceWith([{ kind: 'interactive', cwd: process.cwd(), sessionId: 'idle-session', pid: 22735, status: 'idle' }]);
  await assert.rejects(service.resumable('idle-session'), error => {
    assert.equal(error.statusCode, 409);
    assert.match(error.message, /idle.*22735/);
    assert.match(error.message, /exit/i);
    return true;
  });
});
