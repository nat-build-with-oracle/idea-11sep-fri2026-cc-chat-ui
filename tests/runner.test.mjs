import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ClaudeRunner, StreamNormalizer, normalizeResultUsage, normalizeUsage } from '../server/claude-runner.mjs';

function fakeChild(onInput) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  let input = '';
  child.stdin.on('data', (chunk) => { input += chunk; });
  child.stdin.on('finish', () => onInput?.(child, input));
  child.kill = (signal) => { queueMicrotask(() => child.emit('close', null, signal)); return true; };
  return child;
}

test('runner uses a fresh UUID and name, bypass flag, stdin, shell false and parses split JSONL without duplicate final text', async () => {
  let invocation;
  const spawnFn = (command, args, options) => {
    invocation = { command, args, options };
    return fakeChild((child, input) => {
      assert.equal(input, 'hello');
      const id = args[args.indexOf('--session-id') + 1];
      child.stdout.write(`{"type":"system","subtype":"init","session_id":"${id}"}\n{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}}\n`.slice(0, 90));
      child.stdout.write(`{"type":"system","subtype":"init","session_id":"${id}"}\n{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}}\n`.slice(90));
      child.stdout.end('{"type":"result","subtype":"success","result":"Hi","is_error":false}\n');
      child.emit('close', 0, null);
    });
  };
  const runner = new ClaudeRunner({ spawnFn });
  const result = await runner.run({ chatId: 'c1', title: 'Named chat', model: 'sonnet', permissionMode: 'bypassPermissions', cwd: process.cwd(), prompt: 'hello', onUpdate() {} });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Hi');
  assert.match(result.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.detached, true);
  assert.ok(invocation.args.includes('--dangerously-skip-permissions'));
  assert.ok(invocation.args.includes('--session-id'));
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf('--name'), invocation.args.indexOf('--name') + 2), ['--name', 'Named chat']);
  assert.ok(!invocation.args.includes('hello'));
});

test('runner resumes existing sessions with safe default permission mode and propagates the current title', async () => {
  let args;
  const runner = new ClaudeRunner({ spawnFn(command, passed) { args = passed; return fakeChild((child) => { child.stdout.end('{"type":"result","result":"ok","is_error":false,"session_id":"existing"}\n'); child.emit('close', 0, null); }); } });
  const result = await runner.run({ chatId: 'c', sessionId: 'existing', title: 'Renamed here', model: 'haiku', permissionMode: 'default', cwd: process.cwd(), prompt: 'x', onUpdate() {} });
  assert.equal(result.ok, true);
  assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'default']);
  assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', 'existing']);
  assert.ok(!args.includes('--session-id'));
  assert.deepEqual(args.slice(args.indexOf('--name'), args.indexOf('--name') + 2), ['--name', 'Renamed here']);
});

test('runner aggregates authoritative all-model terminal usage and estimated cost', async () => {
  let finalUpdate;
  const runner = new ClaudeRunner({ spawnFn() { return fakeChild((child) => {
    child.stdout.end(`${JSON.stringify({
      type: 'result', subtype: 'success', result: 'ok', is_error: false, session_id: 'usage-session',
      usage: { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 600, cache_creation_input_tokens: 70 },
      modelUsage: {
        sonnet: { inputTokens: 100, outputTokens: 40, cacheReadInputTokens: 500, cacheCreationInputTokens: 60, costUSD: 0.01 },
        haiku: { inputTokens: 20, outputTokens: 8, cacheReadInputTokens: 30, cacheCreationInputTokens: 4, costUSD: 0.0023 },
      },
      total_cost_usd: 0.0123,
    })}\n`);
    child.emit('close', 0, null);
  }); } });
  const result = await runner.run({ chatId: 'usage', model: 'sonnet', permissionMode: 'default', cwd: process.cwd(), prompt: 'x', onUpdate(update) { if (update.final) finalUpdate = update; } });
  const expected = { inputTokens: 120, outputTokens: 48, cacheReadInputTokens: 530, cacheCreationInputTokens: 64, costUsd: 0.0123, scope: 'allModels' };
  assert.deepEqual(result.usage, expected);
  assert.deepEqual(finalUpdate.usage, expected);
});

test('usage validation requires full real token counts and drops invalid optional values', () => {
  assert.deepEqual(normalizeUsage({ input_tokens: 0, output_tokens: 1, cache_read_input_tokens: -1, cache_creation_input_tokens: Number.NaN }, { totalCostUsd: -2 }), { inputTokens: 0, outputTokens: 1, scope: 'mainAgent' });
  assert.equal(normalizeUsage({ input_tokens: 1 }, { totalCostUsd: 0.1 }), null);
  assert.equal(normalizeUsage({ input_tokens: 1.5, output_tokens: 2 }, { totalCostUsd: 0.1 }), null);
  assert.equal(normalizeUsage({ input_tokens: 1, output_tokens: Number.POSITIVE_INFINITY }, { totalCostUsd: 0.1 }), null);
});

test('older result producers fall back to explicitly main-agent usage without broad cost', () => {
  assert.deepEqual(normalizeResultUsage({
    usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 9, cache_creation_input_tokens: 2 },
    total_cost_usd: 42,
  }), { inputTokens: 7, outputTokens: 3, cacheReadInputTokens: 9, cacheCreationInputTokens: 2, scope: 'mainAgent' });
  assert.equal(normalizeResultUsage({
    modelUsage: { broken: { inputTokens: -1, outputTokens: 3, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
    usage: { input_tokens: 7, output_tokens: 3 },
    total_cost_usd: 42,
  }).costUsd, undefined);
});

test('normalizer parses incremental tool input and tolerates malformed lines', () => {
  let last;
  const parser = new StreamNormalizer((update) => { last = update; });
  parser.push('not-json\n{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"Read","input":{}}}}\n');
  parser.push('{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file\\":\\"a\\"}"}}}\n');
  parser.push('{"type":"stream_event","event":{"type":"content_block_stop","index":1}}\n');
  parser.finish();
  assert.deepEqual(last.tools[0], { id: 'tool-1', name: 'Read', input: { file: 'a' }, status: 'running' });
  assert.equal(parser.protocolErrors.length, 1);
});

test('normalizer preserves repeated text across assistant turns and split UTF-8 bytes', () => {
  let last;
  const parser = new StreamNormalizer((update) => { last = update; });
  const first = '{"type":"stream_event","event":{"type":"message_start"}}\n{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"สวัสดี"}}}\n{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"สวัสดี"}]}}\n';
  const bytes = Buffer.from(first);
  const thaiByte = bytes.indexOf(Buffer.from('ส'));
  parser.push(bytes.subarray(0, thaiByte + 1));
  parser.push(bytes.subarray(thaiByte + 1));
  parser.push('{"type":"assistant","message":{"id":"m2","content":[{"type":"text","text":"สวัสดี"}]}}\n');
  parser.push('{"type":"result","result":"สวัสดี","is_error":false}\n');
  parser.finish();
  assert.equal(last.text, 'สวัสดีสวัสดี');
});

test('tool execution completes on tool_result, not content block stop', () => {
  let last;
  const parser = new StreamNormalizer((update) => { last = update; });
  parser.push('{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"Read","input":{}}}}\n');
  parser.push('{"type":"stream_event","event":{"type":"content_block_stop","index":0}}\n');
  assert.equal(last.tools[0].status, 'running');
  parser.push('{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t","content":"ok"}]}}\n');
  assert.equal(last.tools[0].status, 'complete');
});

test('normalizer captures native assistant and tool-result record UUIDs only', () => {
  const updates = [];
  const parser = new StreamNormalizer(update => updates.push(update));
  parser.push(`${JSON.stringify({ type: 'stream_event', uuid: 'stream-delta-uuid', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'same' } } })}\n`);
  parser.push(`${JSON.stringify({ type: 'user', uuid: 'main-human-uuid', message: { content: [{ type: 'text', text: 'prompt' }] } })}\n`);
  parser.push(`${JSON.stringify({ type: 'assistant', uuid: 'assistant-record-1', message: { id: 'same-api-id', content: [{ type: 'text', text: 'same' }] } })}\n`);
  parser.push(`${JSON.stringify({ type: 'assistant', uuid: 'assistant-record-2', message: { id: 'same-api-id', content: [{ type: 'text', text: 'same' }] } })}\n`);
  parser.push(`${JSON.stringify({ type: 'user', uuid: 'tool-result-record', message: { content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'done' }] } })}\n`);
  parser.finish();
  assert.equal('sourceUuids' in updates[0], false);
  assert.equal('sourceUuids' in updates[1], false);
  assert.deepEqual(updates.at(-1).sourceUuids, ['assistant-record-1', 'assistant-record-2', 'tool-result-record']);
  assert.deepEqual([...parser.sourceUuids], ['assistant-record-1', 'assistant-record-2', 'tool-result-record']);
});

test('runner exposes captured native source UUIDs in updates and its final result', async () => {
  let finalUpdate;
  const runner = new ClaudeRunner({ spawnFn() { return fakeChild(child => {
    child.stdout.end([
      JSON.stringify({ type: 'assistant', uuid: 'assistant-record', session_id: 'source-session', message: { id: 'api-id', content: [{ type: 'tool_use', id: 'tool', name: 'Read', input: {} }] } }),
      JSON.stringify({ type: 'user', uuid: 'tool-result-record', session_id: 'source-session', message: { content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'ok' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'done', is_error: false, session_id: 'source-session' }),
      '',
    ].join('\n'));
    child.emit('close', 0, null);
  }); } });
  const result = await runner.run({
    chatId: 'source-uuids', model: 'sonnet', permissionMode: 'default', cwd: process.cwd(), prompt: 'x',
    onUpdate(update) { if (update.final) finalUpdate = update; },
  });
  assert.deepEqual(finalUpdate.sourceUuids, ['assistant-record', 'tool-result-record']);
  assert.deepEqual(result.sourceUuids, ['assistant-record', 'tool-result-record']);
});

test('runner cancellation interrupts the process and resolves', async () => {
  let child;
  const runner = new ClaudeRunner({ spawnFn() { child = fakeChild(); return child; } });
  const done = runner.run({ chatId: 'cancel', model: 'opus', permissionMode: 'default', cwd: process.cwd(), prompt: 'wait', onUpdate() {} });
  assert.equal(await runner.stop('cancel'), true);
  const result = await done;
  assert.equal(result.interrupted, true);
  assert.equal(result.ok, false);
});

test('runner marks only child process spawn errors as launch failures', async () => {
  const spawnErrorRunner = new ClaudeRunner({ spawnFn() {
    const child = fakeChild();
    queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')));
    return child;
  } });
  const failedLaunch = await spawnErrorRunner.run({ chatId: 'spawn-error', model: 'sonnet', permissionMode: 'default', cwd: process.cwd(), prompt: 'x', onUpdate() {} });
  assert.equal(failedLaunch.launchFailed, true);
  assert.match(failedLaunch.error, /ENOENT/);

  const exitRunner = new ClaudeRunner({ spawnFn() { return fakeChild(child => {
    child.stderr.end('command failed');
    child.emit('close', 2, null);
  }); } });
  const nonzeroExit = await exitRunner.run({ chatId: 'nonzero', model: 'sonnet', permissionMode: 'default', cwd: process.cwd(), prompt: 'x', onUpdate() {} });
  assert.equal(nonzeroExit.ok, false);
  assert.equal('launchFailed' in nonzeroExit, false);
});

test('runner reports a wholly malformed successful stream as an error', async () => {
  const runner = new ClaudeRunner({ spawnFn() { return fakeChild((child) => { child.stdout.end('oops\n'); child.emit('close', 0, null); }); } });
  const result = await runner.run({ chatId: 'bad', model: 'sonnet', permissionMode: 'default', cwd: process.cwd(), prompt: 'x', onUpdate() {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /malformed/);
  assert.equal(result.sessionId, null);
});

test('runner reports a successful exit without terminal result and absorbs stdin EPIPE', async () => {
  const runner = new ClaudeRunner({ spawnFn() { return fakeChild((child) => { child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); child.stdout.end('{"type":"system","subtype":"init","session_id":"s"}\n'); child.emit('close', 0, null); }); } });
  const result = await runner.run({ chatId: 'missing', model: 'sonnet', permissionMode: 'default', cwd: process.cwd(), prompt: 'x', onUpdate() {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /without a result/);
});

test('runner treats terminal error subtypes as failures and tolerates unexpected assistant content shapes', async () => {
  const runner = new ClaudeRunner({ spawnFn() { return fakeChild((child) => {
    child.stdout.end('{"type":"assistant","message":{"content":"unexpected"}}\n{"type":"result","subtype":"error_max_turns","result":"Stopped","session_id":"errored"}\n');
    child.emit('close', 0, null);
  }); } });
  const result = await runner.run({ chatId: 'result-error', model: 'sonnet', permissionMode: 'default', cwd: process.cwd(), prompt: 'x', onUpdate() {} });
  assert.equal(result.ok, false);
  assert.equal(result.sessionId, 'errored');
  assert.match(result.error, /Stopped/);
});
