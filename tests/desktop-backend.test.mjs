import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND_ORIGIN = 'https://cc-chat-ui.laris.workers.dev';
const ENTRYPOINT = fileURLToPath(new URL('../server/index.mjs', import.meta.url));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForExit(child, timeoutMs = 4_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for desktop backend to exit')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function waitUntilListening(origin, child, output) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Desktop backend exited before listening (${child.exitCode})\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`);
    }
    try {
      const response = await fetch(`${origin}/api/state`);
      if (response.status === 200) return;
    } catch {
      // The port is not accepting connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for desktop backend\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`);
}

async function fixture(t, { initialState, desktop = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-desktop-backend-'));
  const dataDir = path.join(root, 'data');
  const cwd = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  const fakeClaude = path.join(root, 'claude');
  await Promise.all([mkdir(cwd), mkdir(home)]);
  if (initialState) {
    await mkdir(dataDir);
    await writeFile(path.join(dataDir, 'state.json'), `${JSON.stringify(initialState(cwd), null, 2)}\n`);
  }
  await writeFile(fakeClaude, '#!/bin/sh\n[ "$1" = "--version" ] && { echo "fake-claude 1.0"; exit 0; }\nexit 97\n');
  await chmod(fakeClaude, 0o755);

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const output = { stdout: '', stderr: '' };
  const child = spawn(process.execPath, [ENTRYPOINT], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOME: home,
      CLAUDE_BIN: fakeClaude,
      CC_CHAT_DATA_DIR: dataDir,
      CC_CHAT_CWD: cwd,
      CC_CHAT_FRONTEND_ORIGIN: FRONTEND_ORIGIN,
      CC_CHAT_ALLOW_ANY_ORIGIN: '',
      CC_CHAT_DESKTOP: desktop ? '1' : '',
      DEV_ORIGIN: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child).catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  });
  await waitUntilListening(origin, child, output);
  return { child, cwd, dataDir, origin, output };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  return { response, value: await response.json() };
}

function openEvents(origin) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${origin}/api/events`, { headers: { origin: FRONTEND_ORIGIN } }, (response) => {
      let content = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        content += chunk;
        if (content.includes('event: state')) resolve({ request, response, content });
      });
    });
    request.once('error', reject);
  });
}

test('desktop backend permits health and state reads from the configured hosted origin', async (t) => {
  const f = await fixture(t);
  const options = { headers: { origin: FRONTEND_ORIGIN } };

  const health = await jsonRequest(`${f.origin}/api/health`, options);
  assert.equal(health.response.status, 200);
  assert.equal(health.response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
  assert.equal(health.value.claudeAvailable, true);
  assert.equal(health.value.claudeVersion, 'fake-claude 1.0');
  assert.equal(health.value.cwd, f.cwd);

  const state = await jsonRequest(`${f.origin}/api/state`, options);
  assert.equal(state.response.status, 200);
  assert.equal(state.response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
  assert.equal(state.value.projects[0].path, f.cwd);
});

test('desktop backend permits SSE from the configured hosted origin', async (t) => {
  const f = await fixture(t);
  const events = await openEvents(f.origin);
  t.after(() => events.request.destroy());

  assert.equal(events.response.statusCode, 200);
  assert.equal(events.response.headers['access-control-allow-origin'], FRONTEND_ORIGIN);
  assert.match(events.content, /event: state/);
});

test('desktop backend approves hosted private-network preflight', async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.origin}/api/state`, {
    method: 'OPTIONS',
    headers: {
      origin: FRONTEND_ORIGIN,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'Content-Type',
      'access-control-request-private-network': 'true',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
  assert.equal(response.headers.get('access-control-allow-private-network'), 'true');
});

test('desktop backend denies an unrelated web origin', async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.origin}/api/state`, { headers: { origin: 'https://unrelated.example' } });

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { error: 'Forbidden origin' });
});

test('desktop status exposes exact hosted CORS and aggregate counts without message contents', async (t) => {
  const secret = 'message content must never appear in status';
  const f = await fixture(t, {
    initialState: (cwd) => ({
      version: 1,
      projects: [{ id: 'project-1', name: 'Workspace', path: cwd, createdAt: '2026-01-01T00:00:00.000Z' }],
      chats: [
        {
          id: 'chat-1', title: 'First', projectId: 'project-1', sessionId: null, model: 'sonnet', permissionMode: 'default',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle',
          messages: [
            { id: 'message-1', role: 'user', content: secret, createdAt: '2026-01-01T00:00:00.000Z', status: 'complete' },
            { id: 'message-2', role: 'assistant', content: 'also private', createdAt: '2026-01-01T00:00:00.000Z', status: 'complete', tools: [] },
          ],
          sync: { status: 'error', error: 'private sync detail' },
        },
        {
          id: 'chat-2', title: 'Second', projectId: null, sessionId: null, model: 'haiku', permissionMode: 'bypassPermissions',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle',
          messages: [{ id: 'message-3', role: 'user', content: 'more private text', createdAt: '2026-01-01T00:00:00.000Z', status: 'complete' }],
        },
      ],
    }),
  });
  const status = await jsonRequest(`${f.origin}/api/status`, { headers: { origin: FRONTEND_ORIGIN } });

  assert.equal(status.response.status, 200);
  assert.equal(status.response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
  assert.equal(status.response.headers.get('vary'), 'Origin');
  assert.deepEqual(status.value, {
    service: 'arra-claude-code',
    apiVersion: 1,
    projects: 1,
    chats: 2,
    messages: 3,
    running: 0,
    syncErrors: 1,
    frontendOrigin: FRONTEND_ORIGIN,
    allowAnyOrigin: false,
  });
  assert.equal(JSON.stringify(status.value).includes(secret), false);
});

test('desktop backend respects its data directory and working-directory environment', async (t) => {
  const f = await fixture(t);
  const state = await jsonRequest(`${f.origin}/api/state`, { headers: { origin: FRONTEND_ORIGIN } });
  assert.equal(state.value.projects[0].path, f.cwd);

  const persisted = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(persisted.projects[0].path, f.cwd);
  assert.deepEqual(persisted.chats, []);

  const startupLine = f.output.stdout.split(/\r?\n/).find((line) => line.trim());
  assert.ok(startupLine, 'entrypoint logs when it starts listening');
  let startupRecord = null;
  try { startupRecord = JSON.parse(startupLine); } catch { /* Older entrypoints log a human-readable line. */ }
  if (startupRecord) {
    assert.equal(typeof startupRecord, 'object');
    assert.match(JSON.stringify(startupRecord), new RegExp(String(new URL(f.origin).port)));
  } else {
    assert.match(startupLine, new RegExp(`127\\.0\\.0\\.1:${new URL(f.origin).port}`));
  }
});

test('SIGTERM closes an open SSE connection after persisting state', async (t) => {
  const f = await fixture(t);
  const created = await jsonRequest(`${f.origin}/api/chats`, {
    method: 'POST',
    headers: { origin: FRONTEND_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Persist before shutdown' }),
  });
  assert.equal(created.response.status, 201);

  const events = await openEvents(f.origin);
  const ended = new Promise((resolve) => events.response.once('end', resolve));
  f.child.kill('SIGTERM');

  const exit = await waitForExit(f.child);
  assert.deepEqual(exit, { code: 0, signal: null });
  await Promise.race([
    ended,
    new Promise((_, reject) => setTimeout(() => reject(new Error('SSE connection did not close during SIGTERM')), 1_000)),
  ]);
  const persisted = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(persisted.chats[0].id, created.value.id);
  assert.equal(persisted.chats[0].title, 'Persist before shutdown');
});

test('desktop stdin shutdown closes an open SSE connection after persisting state', async (t) => {
  const f = await fixture(t, { desktop: true });
  const created = await jsonRequest(`${f.origin}/api/chats`, {
    method: 'POST',
    headers: { origin: FRONTEND_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Persist before stdin shutdown' }),
  });
  assert.equal(created.response.status, 201);

  const events = await openEvents(f.origin);
  const ended = new Promise((resolve) => events.response.once('end', resolve));
  f.child.stdin.end('shutdown\n');

  const exit = await waitForExit(f.child);
  assert.deepEqual(exit, { code: 0, signal: null });
  await Promise.race([
    ended,
    new Promise((_, reject) => setTimeout(() => reject(new Error('SSE connection did not close during stdin shutdown')), 1_000)),
  ]);
  const persisted = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(persisted.chats[0].id, created.value.id);
  assert.equal(persisted.chats[0].title, 'Persist before stdin shutdown');
});
