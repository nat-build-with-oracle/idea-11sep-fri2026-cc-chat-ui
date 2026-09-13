import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOwnedBackend,
  assertVpnListener,
  createVpnStop,
  guardedVpnUpdate,
  listenerPids,
  stopInstalledApp,
  waitForStartedApp,
} from '../scripts/desktop-vpn.mjs';

const resources = '/Applications/ARRA Claude Code Server.app/Contents/Resources/app';

function ownershipRunner({ listener = 'p42\np42\n', processInfo = '501 12\n', cwd = `p42\nn${resources}\n` } = {}) {
  return async (command, args) => {
    if (command === 'ps') return { stdout: processInfo };
    if (command === 'lsof' && args.includes('cwd')) return { stdout: cwd };
    if (command === 'lsof') return { stdout: listener };
    throw new Error(`Unexpected command: ${command}`);
  };
}

test('listener PID parsing deduplicates lsof records without accepting other text', () => {
  assert.deepEqual(listenerPids('p42\nf12\np42\np77\n'), [42, 77]);
  assert.deepEqual(listenerPids('COMMAND PID\nnode 42\n'), []);
});

test('backend ownership requires one listener, the current uid, and the installed resources directory', async () => {
  assert.equal(await assertOwnedBackend(4318, {
    runCommand: ownershipRunner(),
    uid: 501,
    expectedResources: resources,
    expectedParentPid: 12,
  }), 42);

  await assert.rejects(assertOwnedBackend(4318, {
    runCommand: ownershipRunner({ listener: 'p42\np43\n' }),
    uid: 501,
    expectedResources: resources,
  }), /one installed backend/);
  await assert.rejects(assertOwnedBackend(4318, {
    runCommand: ownershipRunner({ processInfo: '502 12\n' }),
    uid: 501,
    expectedResources: resources,
  }), /not this account/);
  await assert.rejects(assertOwnedBackend(4318, {
    runCommand: ownershipRunner({ processInfo: '501 13\n' }),
    uid: 501,
    expectedResources: resources,
    expectedParentPid: 12,
  }), /not this account/);
  await assert.rejects(assertOwnedBackend(4318, {
    runCommand: ownershipRunner({ cwd: 'p42\nn/tmp/other\n' }),
    uid: 501,
    expectedResources: resources,
  }), /not this account/);
});

test('stop waits for the quit request, exact tray exit, and listener release', async () => {
  const events = [];
  const states = [[12], [12], []];
  let releaseQuit;
  const quit = new Promise(resolve => { releaseQuit = resolve; });
  const operation = stopInstalledApp(4318, {
    listAppPids: async () => {
      const state = states.shift();
      events.push(`pids:${state.join(',') || 'none'}`);
      return state;
    },
    runCommand: async (command) => {
      if (command === 'osascript') {
        events.push('quit-start');
        await quit;
        events.push('quit-finished');
        return { stdout: '' };
      }
      events.push('socket-check');
      const error = new Error('no listener');
      error.code = 1;
      error.stdout = '';
      throw error;
    },
    wait: async () => { events.push('wait'); },
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['pids:12', 'quit-start']);
  releaseQuit();
  await operation;
  assert.deepEqual(events, [
    'pids:12', 'quit-start', 'quit-finished',
    'pids:12', 'wait', 'pids:none', 'socket-check',
  ]);
});

test('a replacement tray PID during shutdown aborts before any socket or file work', async () => {
  const states = [[12], [13]];
  const commands = [];
  await assert.rejects(stopInstalledApp(4318, {
    listAppPids: async () => states.shift(),
    runCommand: async (command) => { commands.push(command); return { stdout: '' }; },
    wait: async () => {},
  }), /restarted/);
  assert.deepEqual(commands, ['osascript']);
});

test('shutdown does not finish while a stale listener still owns the port', async () => {
  let socketChecks = 0;
  let waits = 0;
  await stopInstalledApp(4318, {
    listAppPids: async () => [],
    runCommand: async () => {
      socketChecks += 1;
      if (socketChecks < 3) return { stdout: 'p99\n' };
      const error = new Error('no listener');
      error.code = 1;
      error.stdout = '';
      throw error;
    },
    wait: async () => { waits += 1; },
  });
  assert.equal(socketChecks, 3);
  assert.equal(waits, 2);
});

test('restart readiness returns only the exact installed tray PID', async () => {
  const states = [[], [], [55]];
  let waits = 0;
  assert.equal(await waitForStartedApp({
    listAppPids: async () => states.shift(),
    wait: async () => { waits += 1; },
  }), 55);
  assert.equal(waits, 2);
});

test('VPN listener verification is constrained to the restarted owner PID', async () => {
  let capturedArgs;
  await assertVpnListener({ address: '100.64.10.20' }, 4318, 55, {
    runCommand: async (_command, args) => {
      capturedArgs = args;
      return { stdout: 'p55\n' };
    },
  });
  assert.deepEqual(capturedArgs.slice(0, 5), ['-nP', '-a', '-p', '55', '-iTCP@100.64.10.20:4318']);

  await assert.rejects(assertVpnListener({ address: '100.64.10.20' }, 4318, 55, {
    runCommand: async () => ({ stdout: 'p99\n' }),
  }), /not owned by the restarted app/);
});

test('the initial stop always rechecks identity and idle state before quitting', async () => {
  const events = [];
  const stop = createVpnStop({ port: 4318 }, {
    verifySafe: async () => { events.push('verify'); throw new Error('activity unknown'); },
    probeStatus: async () => { events.push('probe'); return {}; },
    stop: async () => { events.push('stop'); },
  });
  await assert.rejects(stop(), /activity unknown/);
  assert.deepEqual(events, ['verify']);
});

test('rollback may stop an exact tray whose replacement backend never became reachable', async () => {
  const events = [];
  const stop = createVpnStop({ port: 4318 }, {
    verifySafe: async () => { events.push('verify'); },
    probeStatus: async () => { events.push('probe'); throw new TypeError('connection refused'); },
    stop: async () => { events.push('stop'); },
  });
  await stop();
  await stop();
  assert.deepEqual(events, ['verify', 'stop', 'probe', 'stop']);
});

test('post-launch verification failure stops the new tray before rollback and recovery', async () => {
  const events = [];
  const releases = [];
  let stopCount = 0;
  const operation = guardedVpnUpdate({
    stop: async () => {
      const index = ++stopCount;
      events.push(`stop-${index}`);
      await new Promise(resolve => releases.push(resolve));
      events.push(`exited-${index}`);
    },
    install: () => events.push('install-files-and-settings'),
    start: () => events.push('launch-new'),
    verify: () => { events.push('verify-owner-and-vpn'); throw new Error('wrong restarted owner'); },
    restore: () => events.push('restore-files-settings-and-signature'),
    recover: () => events.push('launch-recovery'),
  });
  const rejected = assert.rejects(operation, /wrong restarted owner/);

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['stop-1']);
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [
    'stop-1', 'exited-1', 'install-files-and-settings',
    'launch-new', 'verify-owner-and-vpn', 'stop-2',
  ]);
  releases.shift()();
  await rejected;
  assert.deepEqual(events.slice(-3), [
    'exited-2', 'restore-files-settings-and-signature', 'launch-recovery',
  ]);
});

test('a new tray that refuses to stop prevents rollback from touching saved VPN settings', async () => {
  let stops = 0;
  const events = [];
  await assert.rejects(guardedVpnUpdate({
    stop: async () => { if (++stops === 2) throw new Error('new tray still owns files'); },
    install: () => events.push('install'),
    start: () => events.push('start'),
    verify: () => { throw new Error('VPN verification failed'); },
    restore: () => events.push('restore'),
    recover: () => events.push('recover'),
  }), /still owns files/);
  assert.deepEqual(events, ['install', 'start']);
});
