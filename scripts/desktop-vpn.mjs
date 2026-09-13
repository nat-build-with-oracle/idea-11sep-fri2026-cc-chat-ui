import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeUnlockToken, readVpnConfig, resolveVpnAuthMode } from '../server/vpn-access.mjs';
import { assertIdleState, guardedDesktopUpdate, installedAppPids } from './desktop-claude.mjs';

const run = promisify(execFile);
const app = '/Applications/ARRA Claude Code Server.app';
const resources = path.join(app, 'Contents/Resources/app');
const bundle = 'com.buildwithoracle.arra-claude-code-server';
const settingsDir = path.join(os.homedir(), 'Library/Application Support', bundle);
const supportedActions = ['enable', 'reset-key', 'status', 'copy-password', 'copy-unlock', 'copy-unlock-link'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const copyToClipboard = (value) => new Promise((resolve, reject) => {
  const child = execFile('pbcopy', (error) => (error ? reject(error) : resolve()));
  child.stdin.end(value);
});

const originFor = (settings) => `http://127.0.0.1:${settings.port}`;
const vpnUrl = (config, settings) => `http://${config.hostname}:${settings.port}/`;
const makeUnlockLink = (config, settings) => `${vpnUrl(config, settings)}_vpn/lock#unlock=${encodeURIComponent(
  makeUnlockToken(config.password),
)}`;

async function jsonAt(origin, route, timeout = 5000) {
  const response = await fetch(`${origin}${route}`, { redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Backend check failed: HTTP ${response.status}`);
  return response.json();
}

export function listenerPids(output) {
  return [...new Set(String(output).split('\n')
    .filter(line => /^p\d+$/.test(line.trim()))
    .map(line => Number(line.trim().slice(1))))];
}

export async function assertOwnedBackend(port, {
  runCommand = run,
  uid = process.getuid(),
  expectedResources = resources,
  expectedParentPid,
} = {}) {
  const { stdout } = await runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
  const pids = listenerPids(stdout);
  if (pids.length !== 1) throw new Error('Cannot identify one installed backend; no processes were stopped.');
  const pid = pids[0];
  const { stdout: processInfo } = await runCommand('ps', ['-p', String(pid), '-o', 'uid=,ppid=']);
  const { stdout: cwd } = await runCommand('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const [owner, parent] = processInfo.trim().split(/\s+/).map(Number);
  if (owner !== uid
    || (expectedParentPid !== undefined && parent !== expectedParentPid)
    || !cwd.split('\n').includes(`n${expectedResources}`)) {
    throw new Error('This port is not this account’s installed ARRA backend. It was left untouched.');
  }
  return pid;
}

export async function currentAppPids({ runCommand = run, uid = process.getuid() } = {}) {
  const { stdout } = await runCommand('ps', ['-axww', '-o', 'pid=,uid=,comm=']);
  return installedAppPids(stdout, uid);
}

export async function stopInstalledApp(port, {
  runCommand = run,
  listAppPids = currentAppPids,
  wait = pause,
  maxAttempts = 60,
} = {}) {
  const pids = await listAppPids({ runCommand });
  if (pids.length) {
    await runCommand('osascript', ['-e', `tell application id "${bundle}" to quit`]);
    for (let attempt = 0; ; attempt++) {
      const current = await listAppPids({ runCommand });
      if (current.length === 0) break;
      if (current.some(pid => !pids.includes(pid)) || attempt >= maxAttempts) {
        throw new Error('Installed app is still running or restarted. Its files and VPN settings were left untouched.');
      }
      await wait(250);
    }
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
    } catch (error) {
      if (error.code === 1 && !error.stdout) return;
      throw error;
    }
    if (attempt >= maxAttempts) {
      throw new Error('Backend socket is still in use. App files and VPN settings were left untouched.');
    }
    await wait(250);
  }
}

export async function waitForStartedApp({
  runCommand = run,
  listAppPids = currentAppPids,
  wait = pause,
  maxAttempts = 60,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    const pids = await listAppPids({ runCommand });
    if (pids.length === 1) return pids[0];
    if (attempt >= maxAttempts) throw new Error('Installed app did not restart; inspect its output.');
    await wait(250);
  }
}

export async function assertVpnListener(config, port, expectedPid, { runCommand = run } = {}) {
  let stdout;
  try {
    ({ stdout } = await runCommand('lsof', [
      '-nP', '-a', '-p', String(expectedPid),
      `-iTCP@${config.address}:${port}`, '-sTCP:LISTEN', '-Fp',
    ]));
  } catch (error) {
    throw new Error('VPN listener is not owned by the restarted app; inspect its server output.', { cause: error });
  }
  const pids = listenerPids(stdout);
  if (pids.length !== 1 || pids[0] !== expectedPid) {
    throw new Error('VPN listener is not owned by the restarted app; inspect its server output.');
  }
}

export async function guardedVpnUpdate(operations) {
  return guardedDesktopUpdate(operations);
}

export function createVpnStop(settings, {
  verifySafe = assertSafeInstalledBackend,
  probeStatus = () => jsonAt(originFor(settings), '/api/status'),
  stop = () => stopInstalledApp(settings.port),
} = {}) {
  let stopCount = 0;
  return async () => {
    stopCount += 1;
    if (stopCount === 1) {
      await verifySafe(settings);
    } else {
      const live = await probeStatus().catch(() => null);
      if (live) await verifySafe(settings);
    }
    await stop();
  };
}

async function assertSafeInstalledBackend(settings) {
  await access(path.join(resources, 'server/index.mjs'));
  const appPids = await currentAppPids();
  if (appPids.length !== 1) throw new Error('Cannot identify one installed app; nothing was stopped.');
  const pid = await assertOwnedBackend(settings.port, { expectedParentPid: appPids[0] });
  const origin = originFor(settings);
  const status = await jsonAt(origin, '/api/status');
  if (status.service !== 'arra-claude-code') throw new Error('Not an ARRA backend; nothing was stopped.');
  assertIdleState(await jsonAt(origin, '/api/state'));
  return pid;
}

async function verifyRestartedBackend(settings, expectedPid) {
  const origin = originFor(settings);
  const deadline = Date.now() + 15000;
  while (true) {
    try {
      const status = await jsonAt(origin, '/api/status', 1000);
      if (status.service !== 'arra-claude-code') throw new Error('The restarted process is not an ARRA backend.');
      await jsonAt(origin, '/api/state', 1000);
      const appPids = await currentAppPids();
      if (appPids.length !== 1 || appPids[0] !== expectedPid) {
        throw new Error('The ready backend is not owned by the restarted app.');
      }
      return assertOwnedBackend(settings.port, { expectedParentPid: expectedPid });
    } catch (error) {
      if (!['TypeError', 'TimeoutError'].includes(error.name)) throw error;
    }
    if (Date.now() > deadline) throw new Error('App did not become ready; inspect its server output.');
    await pause(200);
  }
}

async function verifyVpnAccess(config, settings) {
  const response = await fetch(`${vpnUrl(config, settings)}api/state`, { signal: AbortSignal.timeout(5000) });
  const expected = config.authMode === 'NO_AUTH' ? 200 : 401;
  if (response.status !== expected) {
    throw new Error(`VPN hostname returned HTTP ${response.status}; expected ${expected}. Check hostname routing and server output.`);
  }
  console.log(`VPN hostname OK: HTTP ${response.status}`);
}

async function copyUnlockLink(settings) {
  const config = await readVpnConfig(settings.data_dir);
  if (!config) throw new Error('Run just desktop-vpn first');
  await copyToClipboard(makeUnlockLink(config, settings));
  console.log('Fresh unlock link copied to the clipboard.');
}

async function validateConfig(config) {
  const validationDir = path.join(settingsDir, `.vpn-validation-${process.pid}`);
  await mkdir(validationDir, { mode: 0o700 });
  try {
    await writeFile(path.join(validationDir, 'vpn-access.json'), JSON.stringify(config), { mode: 0o600 });
    await readVpnConfig(validationDir);
  } finally {
    await rm(validationDir, { recursive: true, force: true });
  }
}

async function installVpn(settings, { regenerateKey, explicitAuthMode }) {
  const file = path.join(settings.data_dir, 'vpn-access.json');
  const previous = await readVpnConfig(settings.data_dir);
  const requestedMode = explicitAuthMode ?? (regenerateKey ? previous?.authMode : undefined) ?? 'WITH_AUTH';
  const authMode = resolveVpnAuthMode(requestedMode, process.env.NODE_ENV);
  await assertSafeInstalledBackend(settings);

  const netbird = JSON.parse((await run('netbird', ['status', '--json'])).stdout);
  const config = {
    address: netbird.netbirdIp?.split('/')[0],
    hostname: netbird.fqdn,
    authMode,
    password: !regenerateKey && previous?.password
      ? previous.password
      : randomBytes(32).toString('base64url'),
  };
  await validateConfig(config);

  const backup = path.join(os.homedir(), '.local/state/arra-app-backups', `vpn-${Date.now()}`);
  await mkdir(backup, { recursive: true, mode: 0o700 });
  const installedServer = path.join(resources, 'server');
  const serverFiles = ['index.mjs', 'vpn-access.mjs', 'vpn-lock-page.mjs'];
  const backedUp = new Set();
  for (const name of serverFiles) {
    try {
      await copyFile(path.join(installedServer, name), path.join(backup, name));
      backedUp.add(name);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (previous) {
    await writeFile(path.join(backup, 'vpn-access.json'), `${JSON.stringify(previous, null, 2)}\n`, { mode: 0o600 });
  }

  const stop = createVpnStop(settings);
  await guardedVpnUpdate({
    stop,
    install: async () => {
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
      for (const name of serverFiles) {
        await copyFile(new URL(`../server/${name}`, import.meta.url), path.join(installedServer, name));
      }
      await run('codesign', ['--force', '--deep', '--sign', '-', app]);
      await run('codesign', ['--verify', '--deep', '--strict', app]);
    },
    start: () => run('open', [app]),
    verify: async () => {
      const restartedPid = await waitForStartedApp();
      const backendPid = await verifyRestartedBackend(settings, restartedPid);
      await assertVpnListener(config, settings.port, backendPid);
      await verifyVpnAccess(config, settings);
    },
    restore: async () => {
      for (const name of serverFiles) {
        if (backedUp.has(name)) {
          await copyFile(path.join(backup, name), path.join(installedServer, name));
        } else {
          await rm(path.join(installedServer, name), { force: true });
        }
      }
      if (previous) {
        await copyFile(path.join(backup, 'vpn-access.json'), file);
      } else {
        await rm(file, { force: true });
      }
      await run('codesign', ['--force', '--deep', '--sign', '-', app]);
      await run('codesign', ['--verify', '--deep', '--strict', app]);
    },
    recover: () => run('open', [app]),
  });

  console.log(`Ready: ${vpnUrl(config, settings)}`);
  console.log(`Authentication mode: ${config.authMode}`);
  if (config.authMode !== 'NO_AUTH') {
    console.log('Copy a fresh unlock link: just desktop-vpn-copy-unlock');
  }
  console.log(`Backup: ${backup}`);
}

export async function main(args = process.argv.slice(2)) {
  if (process.platform !== 'darwin') throw new Error('Desktop VPN setup requires macOS');
  const action = args[0] || 'status';
  const actionArgs = args.slice(1);
  if (!supportedActions.includes(action)) throw new Error(`Use one of: ${supportedActions.join(', ')}`);
  const acceptsAuthMode = action === 'enable' || action === 'reset-key';
  if ((!acceptsAuthMode && actionArgs.length > 0) || actionArgs.length > 1) {
    throw new Error(`${action} received unexpected arguments`);
  }
  const rawAuthMode = actionArgs[0];
  const explicitAuthMode = rawAuthMode?.startsWith('mode=') ? rawAuthMode.slice('mode='.length) : rawAuthMode;
  if (explicitAuthMode !== undefined) resolveVpnAuthMode(explicitAuthMode, process.env.NODE_ENV);

  const settings = JSON.parse(await readFile(path.join(settingsDir, 'server-config.json'), 'utf8'));
  if (['copy-password', 'copy-unlock', 'copy-unlock-link'].includes(action)) {
    if (action === 'copy-password') {
      console.warn('desktop-vpn-copy-password is deprecated; copying an expiring unlock link instead.');
    }
    await copyUnlockLink(settings);
  } else if (action === 'status') {
    const config = await readVpnConfig(settings.data_dir);
    const response = await fetch(`${originFor(settings)}/api/state`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Local backend returned ${response.status}`);
    console.log(`Local backend OK: ${originFor(settings)}`);
    if (config) {
      await verifyVpnAccess(config, settings);
      console.log(`VPN URL: ${vpnUrl(config, settings)}`);
      console.log(`Authentication mode: ${config.authMode}`);
    } else {
      console.log('VPN access is disabled');
    }
    const result = await run('lsof', ['-nP', `-iTCP:${settings.port}`, '-sTCP:LISTEN']);
    console.log(result.stdout);
  } else {
    await installVpn(settings, { regenerateKey: action === 'reset-key', explicitAuthMode });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
