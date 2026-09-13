import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { SessionNamingService, sampleSessionMessages } from '../server/session-naming.mjs';

function fakeSpawner(outputs, calls) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const input = [];
    child.stdin = new Writable({ write(chunk, _encoding, callback) { input.push(Buffer.from(chunk)); callback(); } });
    child.kill = (signal) => {
      calls.at(-1).killedWith = signal;
      queueMicrotask(() => child.emit('close', null));
      return true;
    };
    const call = { command, args, options, input };
    calls.push(call);
    child.stdin.once('finish', () => queueMicrotask(() => {
      const output = outputs.shift();
      if (output === undefined) return;
      child.stdout.end(output.stdout);
      child.stderr.end(output.stderr || '');
      child.emit('close', output.code ?? 0);
    }));
    return child;
  };
}

test('message sampling includes text only and bounds long transcripts with head and tail', () => {
  const messages = [
    { id: 'private-id', role: 'user', content: `HEAD-${'a'.repeat(100)}`, tools: [{ input: { secret: 'tool-secret' } }] },
    { role: 'system', content: 'system-secret' },
    { role: 'assistant', content: `TAIL-${'z'.repeat(100)}`, history: { blocks: [{ content: '/private/path' }] } },
  ];
  const sample = sampleSessionMessages(messages, { maxChars: 100 });

  assert.equal(sample.transcript.length, 100);
  assert.match(sample.transcript, /^USER:\nHEAD-/);
  assert.match(sample.transcript, /z+$/);
  assert.match(sample.transcript, /middle omitted/);
  assert.equal(sample.truncated, true);
  assert.equal(sample.messageCount, 2);
  assert.doesNotMatch(sample.transcript, /private-id|tool-secret|private\/path|system-secret/);
});

test('CLI generator uses two isolated stateless no-tools stages and structured output', async () => {
  const calls = [];
  const service = new SessionNamingService({
    command: 'fake-claude',
    spawnFn: fakeSpawner([
      { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { summary: 'A bounded summary' }, extra: true }) },
      { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { suggestions: ['First title', 'Second title', 'Third title'] } }) },
    ], calls),
    environmentForTarget: ({ model }) => ({ PATH: process.env.PATH, TEST_MODEL: model }),
  });

  const result = await service.suggest({
    messages: [{ role: 'user', content: 'unique transcript marker', tools: [{ input: 'never included' }] }],
    summaryModel: 'haiku',
    context: { kind: 'chat', model: 'sonnet' },
  });

  assert.deepEqual(result, {
    summary: 'A bounded summary', suggestions: ['First title', 'Second title', 'Third title'],
    summaryModel: 'haiku', namingModel: 'opus', truncated: false, messageCount: 1,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'fake-claude');
  assert.equal(calls[0].options.cwd, calls[1].options.cwd);
  assert.equal(calls[0].options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(calls[0].options.env.TEST_MODEL, 'sonnet');
  assert.equal(calls[0].options.env.ANTHROPIC_AUTH_TOKEN, undefined);
  await assert.rejects(access(calls[0].options.cwd), { code: 'ENOENT' });
  assert.equal(Buffer.concat(calls[0].input).toString(), 'USER:\nunique transcript marker');
  assert.equal(Buffer.concat(calls[1].input).toString(), 'A bounded summary');
  assert.doesNotMatch(calls[0].args.join(' '), /unique transcript marker|--resume|--session-id/);
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'haiku');
  assert.equal(calls[1].args[calls[1].args.indexOf('--model') + 1], 'opus');
  for (const call of calls) {
    for (const flag of ['-p', '--safe-mode', '--no-session-persistence', '--no-chrome', '--tools', '--strict-mcp-config', '--setting-sources', '--disable-slash-commands', '--permission-prompts', '--output-format', '--json-schema']) {
      assert.ok(call.args.includes(flag), `missing ${flag}`);
    }
    assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
    assert.equal(call.args[call.args.indexOf('--setting-sources') + 1], '');
    assert.equal(call.args[call.args.indexOf('--permission-prompts') + 1], 'none');
    assert.equal(call.args[call.args.indexOf('--output-format') + 1], 'json');
  }
});

test('pipeline failures and timeouts are bounded and do not start a second stage', async () => {
  const failedCalls = [];
  const failed = new SessionNamingService({
    spawnFn: fakeSpawner([{ stdout: '{not-json' }], failedCalls),
  });
  await assert.rejects(
    failed.suggest({ messages: [{ role: 'user', content: 'hello' }], summaryModel: 'sonnet' }),
    (error) => error.statusCode === 502,
  );
  assert.equal(failedCalls.length, 1);

  const timeoutCalls = [];
  const timed = new SessionNamingService({ spawnFn: fakeSpawner([], timeoutCalls), timeoutMs: 10 });
  await assert.rejects(
    timed.suggest({ messages: [{ role: 'user', content: 'hello' }], summaryModel: 'haiku' }),
    (error) => error.statusCode === 504,
  );
  assert.equal(timeoutCalls[0].killedWith, 'SIGTERM');
});

test('timeout escalates to SIGKILL and releases a child that ignores SIGTERM', async () => {
  const signals = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = (signal) => { signals.push(signal); return true; };
    return child;
  };
  const service = new SessionNamingService({ spawnFn, timeoutMs: 5 });

  await assert.rejects(
    service.suggest({ messages: [{ role: 'user', content: 'hello' }], summaryModel: 'haiku' }),
    (error) => error.statusCode === 504,
  );
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('structured results reject failed subtypes, oversized summaries, and duplicate titles', async () => {
  const wrongSubtype = new SessionNamingService({
    spawnFn: fakeSpawner([{ stdout: JSON.stringify({ subtype: 'error', is_error: false, structured_output: { summary: 'no' } }) }], []),
  });
  await assert.rejects(
    wrongSubtype.suggest({ messages: [{ role: 'user', content: 'hello' }], summaryModel: 'haiku' }),
    (error) => error.statusCode === 502,
  );

  for (const generated of [
    { summary: 'x'.repeat(4_001), suggestions: ['One', 'Two', 'Three'] },
    { summary: 'Summary', suggestions: ['Same', 'same', 'Third'] },
  ]) {
    const service = new SessionNamingService({ generateFn: async () => generated });
    await assert.rejects(
      service.suggest({ messages: [{ role: 'user', content: 'hello' }], summaryModel: 'sonnet' }),
      (error) => error.statusCode === 502,
    );
  }
});

test('only one naming job runs and close aborts the active generator', async () => {
  let release;
  let receivedSignal;
  const service = new SessionNamingService({
    generateFn: ({ signal }) => new Promise((resolve, reject) => {
      receivedSignal = signal;
      release = () => resolve({ summary: 'Summary', suggestions: ['One', 'Two', 'Three'] });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { statusCode: 503 })), { once: true });
    }),
  });
  const active = service.suggest({ messages: [{ role: 'user', content: 'hello' }], summaryModel: 'haiku' });
  await assert.rejects(
    service.suggest({ messages: [{ role: 'user', content: 'other' }], summaryModel: 'sonnet' }),
    (error) => error.statusCode === 409,
  );
  await service.close();
  assert.equal(receivedSignal.aborted, true);
  await assert.rejects(active, (error) => error.statusCode === 503);
  release();
});
