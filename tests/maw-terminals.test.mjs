import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MawTerminalService } from '../server/maw-terminals.mjs';

const CLOSED_MESSAGE = 'Terminal closed or unavailable. Refresh ARRA or explicitly resume the saved session.';

function guardedCommand(sessionName) {
  const quoted = `'${sessionName.replaceAll("'", "'\\''")}'`;
  const exact = `'=${sessionName.replaceAll("'", "'\\''")}'`;
  return `if tmux has-session -t ${exact} 2>/dev/null; then maw a ${quoted}; else printf '%s\\n' '${CLOSED_MESSAGE}'; false; fi`;
}

function outputs({ maw, tmux, ps } = {}) {
  return {
    maw: maw ?? JSON.stringify({ command: 'ls', mode: 'verbose', scope: 'local', json: true, panes: [
      { id: '%94', target: 'safe-session:claude.0', session: 'safe-session', status: 'stale', agent: true },
    ] }),
    tmux: tmux ?? '%94\t400\t$1\t@2\t0\n',
    ps: ps ?? '400 1\n500 400\n',
  };
}

function stubExec(records, values = outputs()) {
  return (command, args, options, callback) => {
    records.push({ command, args, options });
    queueMicrotask(() => callback(null, values[command], ''));
  };
}

test('matches direct and child owner PIDs to the closest live maw pane root', async () => {
  const calls = [];
  const service = new MawTerminalService({ execFileFn: stubExec(calls), cacheMs: 0 });
  const found = await service.locate([400, 500]);
  const terminal = { sessionName: 'safe-session', target: 'safe-session:claude.0', paneId: '%94', attachCommand: guardedCommand('safe-session') };
  assert.deepEqual(found, new Map([[400, terminal], [500, terminal]]));
  assert.deepEqual(calls.map(({ command, args }) => [command, args]), [
    ['maw', ['ls', '--verbose', '--json']],
    ['tmux', ['list-panes', '-a', '-F', '#{pane_id}\t#{pane_pid}\t#{session_id}\t#{window_id}\t#{pane_dead}']],
    ['ps', ['-axo', 'pid=,ppid=']],
  ]);
  for (const call of calls) {
    assert.equal(call.options.timeout, 1500);
    assert.equal(call.options.maxBuffer, 2 * 1024 * 1024);
    assert.equal(call.options.encoding, 'utf8');
  }
});

test('does not guess from titles, ordinary tmux panes, maw status, or dead panes', async () => {
  const values = outputs({
    maw: JSON.stringify({ scope: 'local', panes: [
      { id: '%94', target: 'matching-title:claude.0', session: 'matching-title', status: 'active' },
      { id: '%95', target: 'stale-owner:claude.0', session: 'stale-owner', status: 'stale' },
    ] }),
    tmux: '%93\t300\t$1\t@1\t0\n%94\t400\t$1\t@2\t1\n%95\t500\t$1\t@3\t0\n',
    ps: '300 1\n400 1\n500 1\n',
  });
  const service = new MawTerminalService({ execFileFn: stubExec([], values) });
  assert.deepEqual(await service.locate([300, 400, 500]), new Map([[
    500, { sessionName: 'stale-owner', target: 'stale-owner:claude.0', paneId: '%95', attachCommand: guardedCommand('stale-owner') },
  ]]));
});

test('rejects missing owners, ancestry cycles, excessive depth, and ambiguous pane roots', async () => {
  const ancestry = ['700 701', '701 700'];
  for (let pid = 800; pid <= 865; pid += 1) ancestry.push(`${pid} ${pid + 1}`);
  ancestry.push('866 400', '400 1', '500 400');
  const values = outputs({
    tmux: '%94\t400\t$1\t@2\t0\n%95\t400\t$1\t@3\t0\n',
    ps: `${ancestry.join('\n')}\n`,
  });
  const service = new MawTerminalService({ execFileFn: stubExec([], values) });
  assert.deepEqual(await service.locate([999, 700, 800, 500]), new Map());
});

test('fails closed for unavailable, malformed, non-local, and oversize inventories', async (t) => {
  const cases = [
    (command, _args, _options, callback) => queueMicrotask(() => callback(command === 'maw' ? new Error('missing') : null, outputs()[command])),
    stubExec([], outputs({ tmux: 'not tabs\n' })),
    stubExec([], outputs({ maw: JSON.stringify({ scope: 'remote', panes: [] }) })),
    stubExec([], outputs({ ps: `${'1 0\n'.repeat(10_001)}` })),
  ];
  for (const execFileFn of cases) {
    await t.test('invalid inventory returns no terminal', async () => {
      assert.deepEqual(await new MawTerminalService({ execFileFn }).locate([500]), new Map());
    });
  }
});

test('quotes apostrophes exactly and rejects option-like, colon, or controlled session names', async () => {
  const values = outputs({
    maw: JSON.stringify({ scope: 'local', panes: [
      { id: '%1', session: "a'b; touch /tmp/nope", target: 'display-only' },
      { id: '%2', session: '-danger', target: 'display' },
      { id: '%3', session: 'ssh:remote', target: 'display' },
      { id: '%4', session: 'bad\nname', target: 'display' },
    ] }),
    tmux: '%1\t101\t$1\t@1\t0\n%2\t102\t$1\t@2\t0\n%3\t103\t$1\t@3\t0\n%4\t104\t$1\t@4\t0\n',
    ps: '101 1\n102 1\n103 1\n104 1\n',
  });
  const found = await new MawTerminalService({ execFileFn: stubExec([], values) }).locate([101, 102, 103, 104]);
  assert.deepEqual(found, new Map([[101, {
    sessionName: "a'b; touch /tmp/nope",
    target: 'display-only',
    paneId: '%1',
    attachCommand: guardedCommand("a'b; touch /tmp/nope"),
  }]]));
});

function execute(command, env) {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { env }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function generatedAttachCommand(sessionName) {
  const values = outputs({
    maw: JSON.stringify({ scope: 'local', panes: [{ id: '%1', session: sessionName, target: 'display-only' }] }),
    tmux: '%1\t101\t$1\t@1\t0\n',
    ps: '101 1\n',
  });
  return (await new MawTerminalService({ execFileFn: stubExec([], values) }).locate([101])).get(101).attachCommand;
}

test('guarded attach checks the exact session and invokes maw exactly once when it exists', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maw-attach-'));
  const log = path.join(directory, 'maw.log');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'tmux'), '#!/bin/sh\n[ "$1" = has-session ] && [ "$2" = -t ] && [ "$3" = "$EXPECTED_SESSION" ]\n');
  await writeFile(path.join(directory, 'maw'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$MAW_LOG"\n');
  await Promise.all([chmod(path.join(directory, 'tmux'), 0o755), chmod(path.join(directory, 'maw'), 0o755)]);

  const sessionName = 'exact-session';
  const result = await execute(await generatedAttachCommand(sessionName), {
    ...process.env, PATH: `${directory}:${process.env.PATH}`, EXPECTED_SESSION: `=${sessionName}`, MAW_LOG: log,
  });
  assert.equal(result.error, null);
  assert.equal(result.stdout, '');
  assert.equal(await readFile(log, 'utf8'), `a\n${sessionName}\n`);
});

test('guarded attach fails without invoking maw when the exact session is gone', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maw-attach-'));
  const log = path.join(directory, 'maw.log');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'tmux'), '#!/bin/sh\nexit 1\n');
  await writeFile(path.join(directory, 'maw'), '#!/bin/sh\nprintf invoked > "$MAW_LOG"\n');
  await Promise.all([chmod(path.join(directory, 'tmux'), 0o755), chmod(path.join(directory, 'maw'), 0o755)]);

  const result = await execute(await generatedAttachCommand('closed-session'), {
    ...process.env, PATH: `${directory}:${process.env.PATH}`, MAW_LOG: log,
  });
  assert.notEqual(result.error, null);
  assert.equal(result.stdout, `${CLOSED_MESSAGE}\n`);
  await assert.rejects(stat(log), { code: 'ENOENT' });
});

test('guarded attach keeps apostrophes and shell injection inert', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maw-attach-'));
  const log = path.join(directory, 'maw.log');
  const marker = path.join(directory, 'injected');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'tmux'), '#!/bin/sh\n[ "$1" = has-session ] && [ "$2" = -t ] && [ "$3" = "$EXPECTED_SESSION" ]\n');
  await writeFile(path.join(directory, 'maw'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$MAW_LOG"\n');
  await Promise.all([chmod(path.join(directory, 'tmux'), 0o755), chmod(path.join(directory, 'maw'), 0o755)]);

  const sessionName = `a'b; touch ${marker}; #`;
  const result = await execute(await generatedAttachCommand(sessionName), {
    ...process.env, PATH: `${directory}:${process.env.PATH}`, EXPECTED_SESSION: `=${sessionName}`, MAW_LOG: log,
  });
  assert.equal(result.error, null);
  assert.equal(await readFile(log, 'utf8'), `a\n${sessionName}\n`);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
});

test('clamps command timeout, uses no shell, and performs no mutation commands', async () => {
  const calls = [];
  await new MawTerminalService({ execFileFn: stubExec(calls), timeout: 99_000 }).locate([500]);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.options.timeout, 2000);
    assert.equal('shell' in call.options, false);
  }
  assert.deepEqual(calls.map(({ command }) => command).sort(), ['maw', 'ps', 'tmux']);
});

test('deduplicates inflight refreshes and caches successes and failures without stale success', async () => {
  let clock = 100;
  let generation = 0;
  let calls = 0;
  const execFileFn = (command, _args, _options, callback) => {
    calls += 1;
    const snapshot = generation;
    setTimeout(() => {
      if (snapshot === 1) callback(new Error('refresh failed'));
      else callback(null, outputs()[command]);
    }, 5);
  };
  const service = new MawTerminalService({ execFileFn, cacheMs: 2000, now: () => clock });
  const [first, concurrent] = await Promise.all([service.locate([500]), service.locate([500])]);
  assert.equal(first.has(500), true);
  assert.equal(concurrent.has(500), true);
  assert.equal(calls, 3);
  await service.locate([500]);
  assert.equal(calls, 3);

  clock += 2000;
  generation = 1;
  assert.deepEqual(await service.locate([500]), new Map());
  assert.equal(calls, 6);
  generation = 2;
  assert.deepEqual(await service.locate([500]), new Map());
  assert.equal(calls, 6, 'failed refresh is cached instead of falling back to stale success');
});
