import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from '../server/app.mjs';

const FRONTEND_ORIGIN = 'https://chat.example.com';

class FakeRunner {
  health() { return Promise.resolve({ claudeAvailable: true, claudeVersion: 'test' }); }
  stop() { return Promise.resolve(false); }
  stopAll() { return Promise.resolve(); }
}

async function fixture() {
  const server = await createServer({
    dataDir: await mkdtemp(path.join(os.tmpdir(), 'cc-chat-hosted-origin-')),
    cwd: process.cwd(),
    runner: new FakeRunner(),
    devOrigin: 'http://127.0.0.1:5173',
    frontendOrigin: FRONTEND_ORIGIN,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, close: () => new Promise((resolve) => server.close(resolve)) };
}

function corsHeaders(origin = FRONTEND_ORIGIN) {
  return { origin, 'content-type': 'application/json' };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const value = response.status === 204 ? null : await response.json();
  return { response, value };
}

function rawRequest(origin, { method = 'GET', path: requestPath = '/api/state', headers = {} } = {}) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, method, path: requestPath, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.end();
  });
}

test('trusted hosted origin receives exact CORS headers for API reads, writes, errors, deletes, and SSE', async (t) => {
  const f = await fixture();
  t.after(f.close);

  const state = await requestJson(`${f.origin}/api/state`, { headers: { origin: FRONTEND_ORIGIN } });
  assert.equal(state.response.status, 200);
  assert.equal(state.response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
  assert.equal(state.response.headers.get('vary'), 'Origin');
  assert.equal(state.response.headers.get('access-control-allow-credentials'), null);

  const created = await requestJson(`${f.origin}/api/chats`, {
    method: 'POST',
    headers: corsHeaders(),
    body: '{}',
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);

  const patched = await requestJson(`${f.origin}/api/chats/${created.value.id}`, {
    method: 'PATCH',
    headers: corsHeaders(),
    body: JSON.stringify({ title: 'Hosted chat' }),
  });
  assert.equal(patched.response.status, 200);
  assert.equal(patched.response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);

  const error = await requestJson(`${f.origin}/api/chats/not-found`, { method: 'DELETE', headers: { origin: FRONTEND_ORIGIN } });
  assert.equal(error.response.status, 404);
  assert.equal(error.response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);

  const controller = new AbortController();
  const events = await fetch(`${f.origin}/api/events`, { headers: { origin: FRONTEND_ORIGIN }, signal: controller.signal });
  assert.equal(events.status, 200);
  assert.equal(events.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
  assert.equal(events.headers.get('vary'), 'Origin');
  const firstEvent = await events.body.getReader().read();
  assert.match(Buffer.from(firstEvent.value).toString('utf8'), /event: state/);
  controller.abort();

  const removed = await requestJson(`${f.origin}/api/chats/${created.value.id}`, { method: 'DELETE', headers: { origin: FRONTEND_ORIGIN } });
  assert.equal(removed.response.status, 204);
  assert.equal(removed.response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
});

test('API preflight is bounded and private-network approval is only emitted for validated origins', async (t) => {
  const f = await fixture();
  t.after(f.close);

  const approved = await fetch(`${f.origin}/api/chats`, {
    method: 'OPTIONS',
    headers: {
      origin: FRONTEND_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'Content-Type',
      'access-control-request-private-network': 'true',
    },
  });
  assert.equal(approved.status, 204);
  assert.equal(approved.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
  assert.equal(approved.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, DELETE');
  assert.equal(approved.headers.get('access-control-allow-headers'), 'Content-Type');
  assert.equal(approved.headers.get('access-control-allow-private-network'), 'true');

  const dev = await fetch(`${f.origin}/api/state`, {
    method: 'OPTIONS',
    headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'GET' },
  });
  assert.equal(dev.status, 204);
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');

  for (const headers of [
    { origin: FRONTEND_ORIGIN, 'access-control-request-method': 'PUT' },
    { origin: FRONTEND_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Authorization' },
  ]) {
    const denied = await fetch(`${f.origin}/api/chats`, { method: 'OPTIONS', headers });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
    assert.equal(denied.headers.get('vary'), 'Origin');
    assert.equal(denied.headers.get('access-control-allow-private-network'), null);
  }

  for (const headers of [
    { 'access-control-request-method': 'POST' },
    { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' },
  ]) {
    const denied = await fetch(`${f.origin}/api/chats`, { method: 'OPTIONS', headers });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.equal(denied.headers.get('access-control-allow-private-network'), null);
  }
});

test('rejected hosted requests expose no CORS headers, cannot mutate state, and retain the loopback Host gate', async (t) => {
  const f = await fixture();
  t.after(f.close);

  const denied = await requestJson(`${f.origin}/api/chats`, {
    method: 'POST',
    headers: corsHeaders('https://evil.example'),
    body: '{}',
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.response.headers.get('access-control-allow-origin'), null);
  assert.equal((await requestJson(`${f.origin}/api/state`)).value.chats.length, 0);

  const badHost = await rawRequest(f.origin, { headers: { host: 'evil.example', origin: FRONTEND_ORIGIN } });
  assert.equal(badHost.status, 403);
  assert.equal(badHost.headers['access-control-allow-origin'], undefined);
});

test('hosted frontend configuration rejects anything except one exact credential-free HTTPS origin', async () => {
  const invalid = [
    'null',
    '*',
    'https://*',
    'https://*.workers.dev',
    'http://chat.example.com',
    'https://user:pass@chat.example.com',
    'https://chat.example.com/app',
    'https://chat.example.com?mode=hosted',
    'https://chat.example.com#hosted',
    ' https://chat.example.com',
  ];
  for (const frontendOrigin of invalid) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-hosted-origin-invalid-'));
    await assert.rejects(
      createServer({ dataDir, runner: new FakeRunner(), frontendOrigin }),
      /CC_CHAT_FRONTEND_ORIGIN/,
      frontendOrigin,
    );
  }
});

test('CC_CHAT_FRONTEND_ORIGIN enables the same exact hosted origin policy', async (t) => {
  const previous = process.env.CC_CHAT_FRONTEND_ORIGIN;
  process.env.CC_CHAT_FRONTEND_ORIGIN = FRONTEND_ORIGIN;
  t.after(() => {
    if (previous === undefined) delete process.env.CC_CHAT_FRONTEND_ORIGIN;
    else process.env.CC_CHAT_FRONTEND_ORIGIN = previous;
  });
  const server = await createServer({
    dataDir: await mkdtemp(path.join(os.tmpdir(), 'cc-chat-hosted-origin-env-')),
    runner: new FakeRunner(),
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/state`, { headers: { origin: FRONTEND_ORIGIN } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
});
