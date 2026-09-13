import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createClaudeEnvironment } from '../server/claude-environment.mjs';

const run = promisify(execFile);
const app = '/Applications/ARRA Claude Code Server.app';
const resources = path.join(app, 'Contents/Resources/app');
const binary = path.join(app, 'Contents/MacOS/arra-claude-code-server');
const bundle = 'com.buildwithoracle.arra-claude-code-server';
const root = path.resolve(import.meta.dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function assertPreservedState(before, after) {
  if (!Array.isArray(before?.chats) || !Array.isArray(after?.chats)) throw new Error('Cannot verify saved conversations.');
  const chats = new Map(after.chats.map(chat => [chat.id, chat]));
  for (const chat of before.chats) {
    const current = chats.get(chat.id);
    if (!current) throw new Error('An existing conversation is missing after the update. Current state was kept; inspect the backup.');
    if ((chat.provider !== undefined && chat.provider !== 'claude') || !['sonnet', 'opus', 'haiku'].includes(chat.model)) {
      if (!isDeepStrictEqual(chat, current)) throw new Error('A read-only conversation changed after the update. Current state was kept; inspect the backup.');
      continue;
    }
    const messages = new Map(current.messages.map(message => [message.id, message]));
    for (const message of chat.messages) {
      const saved = messages.get(message.id);
      if (!saved || saved.role !== message.role || saved.content !== message.content) throw new Error('An existing message changed after the update. Current state was kept; inspect the backup.');
    }
  }
}

export function assertIdleState(state) {
  if (!Array.isArray(state?.chats) || state.chats.some(chat => chat.status === 'running')) {
    throw new Error('A chat may be running. Nothing was stopped; finish that turn first.');
  }
}

async function jsonAt(origin, route) {
  const response = await fetch(`${origin}${route}`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Backend check failed: HTTP ${response.status}`);
  return response.json();
}

async function assertOwnedBackend(port) {
  const { stdout } = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
  const pids = [...new Set(stdout.split('\n').filter(line => /^p\d+$/.test(line)).map(line => line.slice(1)))];
  if (pids.length !== 1) throw new Error('Cannot identify one installed backend; no processes were stopped.');
  const { stdout: uid } = await run('ps', ['-p', pids[0], '-o', 'uid=']);
  const { stdout: cwd } = await run('lsof', ['-a', '-p', pids[0], '-d', 'cwd', '-Fn']);
  if (Number(uid.trim()) !== process.getuid() || !cwd.split('\n').includes(`n${resources}`)) {
    throw new Error('This port is not this account’s installed ARRA backend. It was left untouched.');
  }
}

export function installedAppPids(output, uid) {
  const matches = output.split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(match => match?.[3] === binary);
  if (matches.some(match => Number(match[2]) !== uid) || matches.length > 1) throw new Error('Cannot safely stop multiple or another account’s installed app.');
  return matches.map(match => Number(match[1]));
}

async function currentAppPids() {
  const { stdout } = await run('ps', ['-axww', '-o', 'pid=,uid=,comm=']);
  return installedAppPids(stdout, process.getuid());
}

async function stopInstalledApp(port) {
  const pids = await currentAppPids();
  if (pids.length) {
    await run('osascript', ['-e', `tell application id "${bundle}" to quit`]);
    for (let attempt = 0; ; attempt++) {
      const current = await currentAppPids();
      if (current.length === 0) break;
      if (current.some(pid => !pids.includes(pid)) || attempt >= 60) throw new Error('Installed app is still running or restarted. Its bundle was left untouched.');
      await pause(250);
    }
  }
  // Health may fail before process exit (or never start). Wait for the socket,
  // independently of HTTP, after the exact owned tray process has exited.
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
    } catch (error) {
      if (error.code === 1 && !error.stdout) return;
      throw error;
    }
    await pause(250);
  }
  throw new Error('Backend socket is still in use. No app files were replaced.');
}

export async function guardedDesktopUpdate({ stop, install, start, verify, restore, recover }) {
  await stop();
  try {
    await install();
    await start();
    await verify();
  } catch (error) {
    // Stop the exact app even when its backend never became reachable.
    // If stop fails, leave all files intact instead of attempting rollback.
    await stop();
    await restore();
    await recover();
    throw error;
  }
}

function launch(env) {
  const child = spawn(binary, [], { detached: true, stdio: 'ignore', env });
  child.on('error', () => console.error('Unable to launch the installed ARRA app.'));
  child.unref();
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--update') || process.platform !== 'darwin') throw new Error('Use on macOS: just desktop-claude [or just desktop-update-claude].');
  const env = createClaudeEnvironment(process.env);
  const settingsDir = path.join(os.homedir(), 'Library/Application Support', bundle);
  const settings = JSON.parse(await readFile(path.join(settingsDir, 'server-config.json'), 'utf8'));
  if (settings.port !== 4318) throw new Error('Expected the everyday installed app on port 4318; nothing changed.');
  const origin = `http://127.0.0.1:${settings.port}`;
  const update = args.includes('--update');
  await access(binary);
  if (update) { await access(path.join(root, 'dist/version.json')); await access(path.join(root, 'server/claude-environment.mjs')); }
  await assertOwnedBackend(settings.port);
  if ((await currentAppPids()).length !== 1) throw new Error('Cannot identify the installed app process. No changes made.');
  const status = await jsonAt(origin, '/api/status');
  if (status.service !== 'arra-claude-code') throw new Error('Not an ARRA backend; left unchanged.');
  assertIdleState(await jsonAt(origin, '/api/state'));
  const expectedVersion = JSON.parse(await readFile(path.join(update ? root : resources, 'dist/version.json'), 'utf8'));

  let backup;
  let beforeState;
  let stateDigest;
  const statePath = path.join(settings.data_dir, 'state.json');
  if (update) {
    backup = path.join(os.homedir(), '.local/state/arra-app-backups', `claude-${Date.now()}`);
    await mkdir(backup, { recursive: true, mode: 0o700 });
    for (const dir of ['server', 'dist']) await cp(path.join(resources, dir), path.join(backup, dir), { recursive: true });
  }
  // Recheck immediately before stopping this account's app. Never touch Claude or tmux.
  await assertOwnedBackend(settings.port);
  assertIdleState(await jsonAt(origin, '/api/state'));
  await guardedDesktopUpdate({
    stop: async () => {
      const live = await jsonAt(origin, '/api/status').catch(() => null);
      if (live) { await assertOwnedBackend(settings.port); assertIdleState(await jsonAt(origin, '/api/state')); }
      await stopInstalledApp(settings.port);
    },
    install: async () => {
      const stateBytes = await readFile(statePath);
      stateDigest = createHash('sha256').update(stateBytes).digest('hex');
      beforeState = JSON.parse(stateBytes);
      if (update) {
        await cp(statePath, path.join(backup, 'state.json'));
        await cp(path.join(settingsDir, 'server-config.json'), path.join(backup, 'server-config.json'));
        for (const dir of ['server', 'dist']) {
          await rm(path.join(resources, dir), { recursive: true });
          await cp(path.join(root, dir), path.join(resources, dir), { recursive: true });
        }
        await run('codesign', ['--force', '--deep', '--sign', '-', app]);
        await run('codesign', ['--verify', '--deep', '--strict', app]);
      }
      if (createHash('sha256').update(await readFile(statePath)).digest('hex') !== stateDigest) throw new Error('Saved state changed during installation; runtime recovery will not overwrite it.');
    },
    start: () => launch(env),
    verify: async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const health = await jsonAt(origin, '/api/health').catch(() => null);
        if (health?.claudeAvailable && isDeepStrictEqual(health.chatModels, ['sonnet', 'opus', 'haiku']) && !health.providers) {
          await assertOwnedBackend(settings.port);
          if ((await currentAppPids()).length !== 1) throw new Error('Cannot verify the restarted installed app identity.');
          const version = await jsonAt(origin, '/version.json');
          if (!isDeepStrictEqual(version, expectedVersion)) throw new Error('The installed app is serving a different build.');
          assertPreservedState(beforeState, await jsonAt(origin, '/api/state'));
          console.log(`Claude Code ready: ${origin}/ (${version.version})`);
          if (backup) console.log(`Previous runtime and data backed up: ${backup}`);
          return;
        }
        await pause(500);
      }
      throw new Error('App started but Claude-only health did not become available.');
    },
    // Runtime-only rollback: never overwrite legitimate user/native-sync writes.
    // The owner-only state backup remains available for explicit recovery.
    restore: async () => {
      if (backup) {
        for (const dir of ['server', 'dist']) {
          await rm(path.join(resources, dir), { recursive: true, force: true });
          await cp(path.join(backup, dir), path.join(resources, dir), { recursive: true });
        }
        await run('codesign', ['--force', '--deep', '--sign', '-', app]);
      }
    },
    recover: () => launch(env),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
