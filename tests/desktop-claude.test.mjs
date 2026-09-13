import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPreservedState, assertIdleState, guardedDesktopUpdate, installedAppPids } from '../scripts/desktop-claude.mjs';

test('update preserves every old message and exact removed-provider records, allowing additive Claude turns', () => {
  const before = { chats: [
    { id: 'c', model: 'sonnet', sessionId: 's', messages: [{ id: 'm', role: 'user', content: 'keep' }] },
    { id: 'g', provider: 'zai', model: 'glm-5.2', messages: [{ id: 'n', role: 'assistant', content: 'old' }] },
  ] };
  const after = structuredClone(before);
  after.chats[0].messages.push({ id: 'new', role: 'assistant', content: 'new' });
  assert.doesNotThrow(() => assertPreservedState(before, after));
  after.chats[1].model = 'sonnet';
  assert.throws(() => assertPreservedState(before, after), /read-only/);
  const lost = structuredClone(before);
  lost.chats[0].messages[0].content = 'overwritten';
  assert.throws(() => assertPreservedState(before, lost), /message/);
  assert.throws(() => assertPreservedState(before, { chats: [] }), /conversation/);
});

test('launcher has no key prompt and rollback restores runtime only, retaining data backups', async () => {
  const source = await readFile(new URL('../scripts/desktop-claude.mjs', import.meta.url), 'utf8');
  const restore = source.slice(source.indexOf('    restore: async'), source.indexOf('    recover:'));
  assert.doesNotMatch(source, /ZAI_API_KEY|dualProviderEnvironment/);
  assert.match(source, /await cp\(statePath, path.join\(backup, 'state.json'\)\)/);
  assert.doesNotMatch(restore, /statePath|state\.json|settingsDir|data_dir/);
  assert.match(restore, /\['server', 'dist'\]/);
});

test('desktop launcher refuses unknown or active chat state', () => {
  assert.throws(() => assertIdleState(null), /Nothing was stopped/);
  assert.throws(() => assertIdleState({ chats: [{ status: 'running' }] }), /Nothing was stopped/);
  assert.doesNotThrow(() => assertIdleState({ chats: [{ status: 'idle' }] }));
});

test('tray identity requires the exact binary path and current account', () => {
  const bin = '/Applications/ARRA Claude Code Server.app/Contents/MacOS/arra-claude-code-server';
  assert.deepEqual(installedAppPids(`12 501 ${bin}\n13 501 /other/arra-claude-code-server`, 501), [12]);
  assert.throws(() => installedAppPids(`12 502 ${bin}`, 501), /another account/);
  assert.throws(() => installedAppPids(`12 501 ${bin}\n13 501 ${bin}`, 501), /multiple/);
});

for (const failure of ['new backend failed to start', 'health timeout']) {
  test(`updater waits for old and new trays before install or rollback: ${failure}`, async () => {
    const events = [];
    const releases = [];
    let stopCount = 0;
    const operation = guardedDesktopUpdate({
      stop: async () => {
        const index = ++stopCount;
        events.push(`stop-${index}`);
        await new Promise(resolve => releases.push(resolve));
        events.push(`exited-${index}`);
      },
      install: () => events.push('replace-and-sign'),
      start: () => events.push('launch-new'),
      verify: () => { events.push('verify'); throw new Error(failure); },
      restore: () => events.push('restore-and-sign'),
      recover: () => events.push('launch-recovery'),
    });
    const rejected = assert.rejects(operation, new RegExp(failure));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['stop-1']);
    releases.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['stop-1', 'exited-1', 'replace-and-sign', 'launch-new', 'verify', 'stop-2']);
    releases.shift()();
    await rejected;
    assert.deepEqual(events.slice(-3), ['exited-2', 'restore-and-sign', 'launch-recovery']);
  });
}

test('a tray that refuses to stop prevents restoration and relaunch', async () => {
  let stops = 0;
  const events = [];
  await assert.rejects(guardedDesktopUpdate({
    stop: async () => { if (++stops === 2) throw new Error('still running'); },
    install: () => events.push('install'), start: () => events.push('start'),
    verify: () => { throw new Error('health timeout'); },
    restore: () => events.push('restore'), recover: () => events.push('recover'),
  }), /still running/);
  assert.deepEqual(events, ['install', 'start']);
});
