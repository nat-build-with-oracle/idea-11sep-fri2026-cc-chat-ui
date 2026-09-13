import http from 'node:http';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { renderVpnLockPage } from './vpn-lock-page.mjs';

// Optional second listener. Never widens the desktop's loopback listener.
export async function readVpnConfig(dataDir) {
  const file = path.join(dataDir, 'vpn-access.json');
  let raw;
  try {
    const info = await stat(file);
    if (info.mode & 0o077) throw new Error('vpn-access.json must have mode 600');
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const octets = String(raw.address).split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
    octets[0] !== 100 ||
    octets[1] < 64 ||
    octets[1] > 127 ||
    octets.join('.') !== raw.address
  ) {
    throw new Error('VPN address must be an explicit CGNAT IPv4 address');
  }
  if (!Object.values(networkInterfaces()).flat().some((item) => item?.address === raw.address && !item.internal)) {
    throw new Error('Configured VPN address is not assigned to this machine');
  }
  if (!/^[a-z0-9-]+\.oracle\.netbird$/.test(raw.hostname)) {
    throw new Error('Expected an exact oracle.netbird hostname');
  }
  if (typeof raw.password !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(raw.password)) {
    throw new Error('VPN password must be a random URL-safe secret of at least 32 characters');
  }
  return { ...raw, authMode: resolveVpnAuthMode(raw.authMode) };
}

// The override is explicit and local to this VPN listener, never a global auth bypass.
export function resolveVpnAuthMode(mode = 'WITH_AUTH', nodeEnv = process.env.NODE_ENV) {
  if (!['NO_AUTH', 'WITH_AUTH', 'PROD'].includes(mode)) {
    throw new Error('VPN auth mode must be NO_AUTH, WITH_AUTH, or PROD');
  }
  if (nodeEnv === 'production' && mode === 'NO_AUTH') {
    throw new Error('NO_AUTH is not allowed with NODE_ENV=production');
  }
  return mode;
}

const UNLOCK_TTL = 15 * 60 * 1000;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const COOKIE_NAME = 'arra_vpn_session';

// Only the local CLI can mint links. Browser sessions are separate, opaque IDs.
export function makeUnlockToken(password, ttlMs = UNLOCK_TTL, now = Date.now()) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > UNLOCK_TTL || !Number.isSafeInteger(now + ttlMs)) {
    throw new Error('Unlock link lifetime must be between 1 ms and 15 minutes');
  }
  const payload = `v1.unlock.${now + ttlMs}.${randomBytes(24).toString('base64url')}`;
  return `${payload}.${createHmac('sha256', password).update(payload).digest('base64url')}`;
}

export function verifyUnlockToken(password, token, now = Date.now()) {
  if (typeof token !== 'string' || !/^v1\.unlock\.[1-9][0-9]{0,15}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const parts = token.split('.');
  const expiry = Number(parts[2]);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + UNLOCK_TTL) return false;
  const payload = parts.slice(0, -1).join('.');
  const expected = createHmac('sha256', password).update(payload).digest('base64url');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(parts[4]));
}

async function readToken(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (Buffer.byteLength(body) > 4096) throw new Error('Payload too large');
  }
  return JSON.parse(body)?.token;
}

export function createVpnProxy({ address, hostname, password, authMode, port, upstreamPort = port, loopbackServer, sessions = new Map() }) {
  const mode = resolveVpnAuthMode(authMode);
  const noAuth = mode === 'NO_AUTH';
  const authorities = new Set([`${hostname}:${port}`, `${address}:${port}`]);
  const revoke = (id) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    clearTimeout(session.timer);
    for (const response of session.responses) response.destroy();
  };
  const cookieId = (request) => (request.headers.cookie || '').split(';')
    .map(pair => pair.trim()).find(pair => pair.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  const getSession = (request) => {
    const id = cookieId(request);
    const session = sessions.get(id);
    if (session && session.expiresAt <= Date.now()) { revoke(id); return null; }
    return session;
  };
  const cookie = (id, age) => `${COOKIE_NAME}=${id}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${age}`;

  const server = http.createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    const reject = (status, message) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: message }));
    };
    const authority = request.headers.host;
    if (!authorities.has(authority)) return reject(403, 'Unapproved VPN host');
    if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) return reject(400, 'Invalid path');
    let url;
    try { url = new URL(request.url, `http://${authority}`); } catch { return reject(400, 'Invalid path'); }
    if (url.origin !== `http://${authority}` || url.hash) return reject(400, 'Invalid path');
    const origin = request.headers.origin;
    if (origin && origin !== url.origin) return reject(403, 'Unapproved origin');
    const appPage = /^\/(?:sessions(?:\/[^/]+)?|chats(?:\/[^/]+)?|new)?\/?$/.test(url.pathname);
    const entryNavigation = request.method === 'GET' && (appPage || url.pathname === '/_vpn/lock')
      && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
    if (request.headers['sec-fetch-site'] === 'cross-site' && !entryNavigation) return reject(403, 'Cross-site request rejected');
    if (!['GET', 'HEAD'].includes(request.method) && origin !== url.origin) return reject(403, 'Same-origin request required');

    if (url.pathname === '/_vpn/lock') {
      if (request.method !== 'GET') return reject(405, 'Method not allowed');
      const nonce = randomBytes(18).toString('base64url');
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
        'x-frame-options': 'DENY',
      });
      return response.end(renderVpnLockPage({ nonce, authenticated: !!getSession(request), noAuth }));
    }

    if (['/_vpn/unlock', '/_vpn/logout'].includes(url.pathname)) {
      if (request.method !== 'POST') return reject(405, 'Method not allowed');
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reject(415, 'JSON request required');
      if (url.pathname === '/_vpn/logout') {
        revoke(cookieId(request));
        response.writeHead(204, { 'set-cookie': cookie('', 0) });
        return response.end();
      }
      if (noAuth) return reject(409, 'VPN login is disabled in NO_AUTH mode');
      readToken(request).then(token => {
        if (!verifyUnlockToken(password, token)) return reject(401, 'Unlock link is invalid or expired. Copy a new link from this Mac.');
        if (sessions.size >= 256) return reject(429, 'Too many unlocked browsers. Lock an unused browser or restart the app.');
        revoke(cookieId(request));
        const id = randomBytes(32).toString('base64url');
        sessions.set(id, {
          expiresAt: Date.now() + SESSION_TTL,
          responses: new Set(),
          timer: setTimeout(() => revoke(id), SESSION_TTL).unref(),
        });
        response.writeHead(204, { 'set-cookie': cookie(id, SESSION_TTL / 1000) });
        response.end();
      }).catch(() => { if (!response.destroyed) reject(400, 'Invalid unlock request'); });
      return;
    }
    if (url.pathname.startsWith('/_vpn/')) return reject(404, 'Not found');

    const session = getSession(request);
    if (!noAuth && !session) {
      if (appPage && request.method === 'GET') {
        response.writeHead(302, { location: '/_vpn/lock' });
        return response.end();
      }
      return reject(401, 'VPN access is locked. Open /_vpn/lock to unlock this browser.');
    }
    if (appPage && url.searchParams.get('host') !== url.origin) {
      url.searchParams.set('host', url.origin);
      response.writeHead(302, { location: `${url.pathname}${url.search}` });
      return response.end();
    }

    const headers = { ...request.headers, host: `127.0.0.1:${upstreamPort}` };
    // No VPN credential or client-supplied forwarding identity reaches the backend.
    for (const key of ['authorization', 'proxy-authorization', 'cookie', 'forwarded']) delete headers[key];
    for (const key of Object.keys(headers)) if (key.startsWith('x-forwarded-')) delete headers[key];
    if (headers.origin) headers.origin = `http://127.0.0.1:${upstreamPort}`;
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: request.url, method: request.method, headers }, incoming => {
      const outputHeaders = { ...incoming.headers, 'cache-control': 'no-store' };
      if (outputHeaders['access-control-allow-origin']) outputHeaders['access-control-allow-origin'] = url.origin;
      response.writeHead(incoming.statusCode, outputHeaders);
      incoming.pipe(response);
    });
    session?.responses.add(response);
    upstream.on('error', () => {
      if (response.headersSent) response.destroy();
      else reject(502, 'Local backend unavailable');
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { session?.responses.delete(response); upstream.destroy(); });
    request.pipe(upstream);
  });
  server.requestTimeout = 15000;
  server.on('close', () => { for (const id of sessions.keys()) revoke(id); });
  if (loopbackServer) {
    // This Mac may resolve its own VPN hostname to loopback. Send that exact
    // identity through the same auth/origin checks, not the localhost handler.
    const app = loopbackServer.app;
    loopbackServer.removeListener('request', app);
    loopbackServer.on('request', (request, response) => {
      if (authorities.has(request.headers.host)) server.emit('request', request, response);
      else void app(request, response);
    });
  }
  return server;
}
