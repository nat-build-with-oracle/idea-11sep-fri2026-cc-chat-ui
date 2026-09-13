import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/app.mjs';
import {
  createVpnProxy,
  makeUnlockToken,
  readVpnConfig,
  resolveVpnAuthMode,
  verifyUnlockToken,
} from '../server/vpn-access.mjs';

const password = 'a'.repeat(40);
const authority = 'workstation.example:4318';
const ownOrigin = `http://${authority}`;

function request({ port, pathname = '/', method = 'GET', headers = {}, payload }) {
  const body = payload === undefined ? null : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        host: authority,
        ...(body === null ? {} : {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        }),
        ...headers,
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function startProxy(t, { authMode, backendHandler, sessions, authorityPort = 4318 } = {}) {
  const backend = http.createServer(backendHandler || ((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, headers: req.headers }));
  }));
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');

  const proxy = createVpnProxy({
    address: '100.64.10.20',
    hostname: 'workstation.example',
    password,
    authMode,
    port: authorityPort,
    upstreamPort: backend.address().port,
    sessions,
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');

  t.after(() => {
    proxy.closeAllConnections();
    proxy.close();
    backend.closeAllConnections();
    backend.close();
  });
  return { backend, proxy, port: proxy.address().port };
}

async function unlock(port, { token = makeUnlockToken(password), origin = ownOrigin, contentType = 'application/json' } = {}) {
  return request({
    port,
    pathname: '/_vpn/unlock',
    method: 'POST',
    headers: { origin, 'content-type': contentType },
    payload: { token },
  });
}

function cookieFrom(response) {
  return response.headers['set-cookie']?.[0].split(';')[0];
}

test('makeUnlockToken creates a token valid before its deterministic expiry', () => {
  const token = makeUnlockToken(password, 1_000, 10_000);
  assert.equal(verifyUnlockToken(password, token, 10_999), true);
});

test('verifyUnlockToken rejects a token at its expiry instant', () => {
  const token = makeUnlockToken(password, 1_000, 10_000);
  assert.equal(verifyUnlockToken(password, token, 11_000), false);
});

test('verifyUnlockToken rejects a tampered token', () => {
  const token = makeUnlockToken(password, 1_000, 10_000);
  assert.equal(verifyUnlockToken(password, `${token.slice(0, -1)}x`, 10_500), false);
});

test('verifyUnlockToken rejects a token with extra segments', () => {
  const token = makeUnlockToken(password, 1_000, 10_000);
  assert.equal(verifyUnlockToken(password, `${token}.extra`, 10_500), false);
});

test('verifyUnlockToken rejects a token signed by a different key', () => {
  const token = makeUnlockToken('b'.repeat(40), 1_000, 10_000);
  assert.equal(verifyUnlockToken(password, token, 10_500), false);
});

test('verifyUnlockToken rejects a correctly signed token for a different purpose', () => {
  const payload = `v1.session.11000.${'c'.repeat(32)}`;
  const signature = createHmac('sha256', password).update(payload).digest('base64url');
  assert.equal(verifyUnlockToken(password, `${payload}.${signature}`, 10_500), false);
});

test('resolveVpnAuthMode defaults to WITH_AUTH', () => {
  assert.equal(resolveVpnAuthMode(undefined, 'development'), 'WITH_AUTH');
});

test('resolveVpnAuthMode rejects an unknown mode', () => {
  assert.throws(() => resolveVpnAuthMode('FAST_AUTH', 'development'), /NO_AUTH, WITH_AUTH, or PROD/);
});

test('resolveVpnAuthMode rejects NO_AUTH in production', () => {
  assert.throws(() => resolveVpnAuthMode('NO_AUTH', 'production'), /not allowed/);
});

for (const [label, authMode] of [['omitted mode', undefined], ['WITH_AUTH', 'WITH_AUTH'], ['PROD', 'PROD']]) {
  test(`${label} returns an API 401 without a browser authentication challenge`, async (t) => {
    const { port } = await startProxy(t, { authMode });
    const response = await request({ port, pathname: '/api/state' });
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], undefined);
  });

  test(`${label} redirects the unauthenticated root to the ARRA lock page`, async (t) => {
    const { port } = await startProxy(t, { authMode });
    const response = await request({ port });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/_vpn/lock');
  });
}

test('NO_AUTH proxies API requests without setting a session cookie', async (t) => {
  const { port } = await startProxy(t, { authMode: 'NO_AUTH' });
  const response = await request({ port, pathname: '/api/state' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('NO_AUTH keeps exact-host validation enabled', async (t) => {
  const { port } = await startProxy(t, { authMode: 'NO_AUTH' });
  const response = await request({ port, pathname: '/api/state', headers: { host: 'evil.example:4318' } });
  assert.equal(response.status, 403);
});

test('NO_AUTH keeps same-origin validation enabled', async (t) => {
  const { port } = await startProxy(t, { authMode: 'NO_AUTH' });
  const response = await request({ port, pathname: '/api/state', headers: { origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
});

test('NO_AUTH keeps cross-site API protection enabled', async (t) => {
  const { port } = await startProxy(t, { authMode: 'NO_AUTH' });
  const response = await request({ port, pathname: '/api/state', headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(response.status, 403);
});

for (const authMode of ['NO_AUTH', 'WITH_AUTH']) {
  test(`${authMode} routes the VPN hostname on loopback through the real backend and VPN checks`, async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'arra-vpn-loopback-'));
    const distDir = path.join(dataDir, 'dist');
    await mkdir(distDir);
    await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>ARRA</title>');
    const backend = await createServer({ dataDir, distDir, allowAnyOrigin: false });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const port = backend.address().port;
    const proxy = createVpnProxy({
      address: '100.64.10.20', hostname: 'workstation.example', password,
      authMode, port: 4318, upstreamPort: port, loopbackServer: backend,
    });
    t.after(async () => {
      proxy.closeAllConnections();
      proxy.close();
      backend.closeAllConnections();
      await backend.app.close();
      await new Promise(resolve => backend.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    });

    let cookie;
    if (authMode === 'WITH_AUTH') {
      const locked = await request({ port, pathname: '/api/state' });
      assert.equal(locked.status, 401);
      const login = await unlock(port);
      assert.equal(login.status, 204);
      cookie = cookieFrom(login);
    }
    const headers = { ...(cookie ? { cookie } : {}), origin: ownOrigin };
    const root = await request({ port, headers });
    assert.equal(root.status, 302);
    const page = await request({ port, pathname: root.headers.location, headers });
    assert.equal(page.status, 200);
    assert.match(page.body, /<!doctype html>/i);
    const sessionEntry = await request({ port, pathname: '/sessions?keep=1', headers });
    assert.equal(sessionEntry.status, 302);
    const sessionUrl = new URL(sessionEntry.headers.location, ownOrigin);
    assert.equal(sessionUrl.pathname, '/sessions');
    assert.equal(sessionUrl.searchParams.get('host'), ownOrigin);
    assert.equal(sessionUrl.searchParams.get('keep'), '1');
    const sessions = await request({ port, pathname: sessionEntry.headers.location, headers });
    assert.equal(sessions.status, 200);
    assert.match(sessions.body, /<!doctype html>/i);
    const state = await request({ port, pathname: '/api/state', headers });
    assert.equal(state.status, 200);
    assert.ok(Array.isArray(JSON.parse(state.body).chats));
    assert.equal(state.headers['access-control-allow-origin'], ownOrigin);
    assert.equal((await request({ port, pathname: '/api/state', headers: { ...headers, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request({ port, pathname: '/api/state', headers: { host: 'evil.example:4318' } })).status, 403);
    assert.equal((await request({ port, pathname: '/api/state', headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await request({ port, pathname: '/api/state', headers: { host: `127.0.0.1:${port}` } })).status, 200);
    if (cookie) {
      await request({ port, pathname: '/_vpn/logout', method: 'POST', headers, payload: {} });
      assert.equal((await request({ port, pathname: '/api/state', headers })).status, 401);
    }
  });
}

test('unlock requires an explicit same-origin Origin header', async (t) => {
  const { port } = await startProxy(t);
  const response = await request({
    port,
    pathname: '/_vpn/unlock',
    method: 'POST',
    payload: { token: makeUnlockToken(password) },
  });
  assert.equal(response.status, 403);
});

test('unlock requires an application/json request body', async (t) => {
  const { port } = await startProxy(t);
  const response = await unlock(port, { contentType: 'text/plain' });
  assert.equal(response.status, 415);
});

test('unlock returns an opaque HttpOnly SameSite=Strict session cookie', async (t) => {
  const { port } = await startProxy(t);
  const response = await unlock(port);
  assert.equal(response.status, 204);
  const setCookie = response.headers['set-cookie']?.[0];
  assert.match(setCookie, /^arra_vpn_session=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /; HttpOnly;/);
  assert.match(setCookie, /; SameSite=Strict;/);
  assert.doesNotMatch(setCookie, /v1\.unlock/);
});

test('an unlock token cannot be used directly as a session cookie', async (t) => {
  const { port } = await startProxy(t);
  const token = makeUnlockToken(password);
  const response = await request({ port, pathname: '/api/state', headers: { cookie: `arra_vpn_session=${token}` } });
  assert.equal(response.status, 401);
});

test('authenticated proxying rewrites local identity and strips credentials', async (t) => {
  const { backend, port } = await startProxy(t);
  const login = await unlock(port);
  const response = await request({
    port,
    pathname: '/api/state',
    headers: {
      cookie: `${cookieFrom(login)}; client_cookie=secret`,
      origin: ownOrigin,
      authorization: 'Bearer secret',
      forwarded: 'for=203.0.113.1',
      'x-forwarded-for': '203.0.113.1',
      'x-forwarded-host': 'evil.example',
    },
  });
  assert.equal(response.status, 200);
  const { headers } = JSON.parse(response.body);
  assert.equal(headers.host, `127.0.0.1:${backend.address().port}`);
  assert.equal(headers.origin, `http://127.0.0.1:${backend.address().port}`);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.forwarded, undefined);
  assert.equal(headers['x-forwarded-for'], undefined);
  assert.equal(headers['x-forwarded-host'], undefined);
});

test('logout revokes the current browser session', async (t) => {
  const { port } = await startProxy(t);
  const login = await unlock(port);
  const cookie = cookieFrom(login);
  const logout = await request({
    port,
    pathname: '/_vpn/logout',
    method: 'POST',
    headers: { cookie, origin: ownOrigin },
    payload: {},
  });
  assert.equal(logout.status, 204);
  assert.equal((await request({ port, pathname: '/api/state', headers: { cookie } })).status, 401);
});

for (const authMode of ['WITH_AUTH', 'PROD']) {
  test(`${authMode} Timeline bridge shares login and logout without a second cookie`, async (t) => {
    const sessions = new Map();
    const app = await startProxy(t, { authMode, sessions });
    const timeline = await startProxy(t, { authMode, sessions, authorityPort: 47882 });
    const timelineOrigin = 'http://workstation.example:47882';
    const headers = { host: 'workstation.example:47882', origin: timelineOrigin };
    const locked = await request({ port: timeline.port, pathname: '/api/timeline', headers });
    assert.equal(locked.status, 401);
    const login = await unlock(app.port);
    assert.equal(login.status, 204);
    const cookie = cookieFrom(login);
    const response = await request({ port: timeline.port, pathname: '/api/timeline', headers: { ...headers, cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['set-cookie'], undefined);
    const forwarded = JSON.parse(response.body);
    assert.equal(forwarded.headers.host, `127.0.0.1:${timeline.backend.address().port}`);
    assert.equal(forwarded.headers.cookie, undefined);
    assert.equal((await request({ port: timeline.port, pathname: '/api/timeline', headers: { ...headers, cookie, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request({ port: timeline.port, pathname: '/api/timeline', headers: { host: '127.0.0.1:47882', cookie } })).status, 403);
    const logout = await request({ port: timeline.port, pathname: '/_vpn/logout', method: 'POST', headers: { ...headers, cookie }, payload: {} });
    assert.equal(logout.status, 204);
    assert.equal((await request({ port: app.port, pathname: '/api/state', headers: { cookie } })).status, 401);
    assert.equal((await request({ port: timeline.port, pathname: '/api/timeline', headers: { ...headers, cookie } })).status, 401);
  });
}

test('the lock page sends a strict CSP and is never cached', async (t) => {
  const { port } = await startProxy(t);
  const response = await request({ port, pathname: '/_vpn/lock' });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.body, /This workspace is locked/);
});

test('a cross-site top-level navigation may enter the lock page', async (t) => {
  const { port } = await startProxy(t);
  const response = await request({
    port,
    pathname: '/_vpn/lock',
    headers: {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    },
  });
  assert.equal(response.status, 200);
});

test('a cross-site API request is rejected', async (t) => {
  const { port } = await startProxy(t);
  const response = await request({ port, pathname: '/api/state', headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(response.status, 403);
});

test('invalid request targets are rejected before proxying', async (t) => {
  const { port } = await startProxy(t, { authMode: 'NO_AUTH' });
  for (const pathname of ['//evil.example/api/state', '/api\\state']) {
    assert.equal((await request({ port, pathname })).status, 400, pathname);
  }
});

test('unknown VPN control paths return 404', async (t) => {
  const { port } = await startProxy(t, { authMode: 'NO_AUTH' });
  assert.equal((await request({ port, pathname: '/_vpn/missing' })).status, 404);
});

test('VPN configuration is opt-in', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arra-vpn-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(await readVpnConfig(dir), null);
});

test('VPN configuration rejects broad bind addresses', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arra-vpn-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'vpn-access.json'), JSON.stringify({ address: '0.0.0.0' }), { mode: 0o600 });
  await assert.rejects(readVpnConfig(dir), /CGNAT/);
});

test('VPN configuration rejects credentials readable by other users', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arra-vpn-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'vpn-access.json');
  await writeFile(file, JSON.stringify({ address: '0.0.0.0' }), { mode: 0o600 });
  await chmod(file, 0o644);
  await assert.rejects(readVpnConfig(dir), /mode 600/);
});

test('VPN proxy forwards SSE data immediately and closes upstream after viewer disconnect', { timeout: 3_000 }, async (t) => {
  let upstreamClosed;
  const upstreamClosedPromise = new Promise(resolve => { upstreamClosed = resolve; });
  const { port } = await startProxy(t, {
    authMode: 'NO_AUTH',
    backendHandler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: live\n\n');
      res.on('close', upstreamClosed);
    },
  });

  await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { host: authority } }, res => {
      res.once('data', chunk => {
        assert.equal(chunk.toString(), 'data: live\n\n');
        res.destroy();
        resolve();
      });
    });
    req.on('error', reject);
  });
  await upstreamClosedPromise;
});

test('logout closes open SSE responses belonging to the revoked session', { timeout: 3_000 }, async (t) => {
  const { port } = await startProxy(t, {
    backendHandler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: live\n\n');
    },
  });
  const login = await unlock(port);
  const cookie = cookieFrom(login);

  await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { host: authority, cookie } }, res => {
      res.once('data', async () => {
        res.once('close', resolve);
        try {
          const logout = await request({
            port,
            pathname: '/_vpn/logout',
            method: 'POST',
            headers: { cookie, origin: ownOrigin },
            payload: {},
          });
          assert.equal(logout.status, 204);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
  });
});
