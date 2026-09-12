import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeRunner } from './claude-runner.mjs';
import { NativeSessionService } from './native-sessions.mjs';
import { TranscriptSync } from './transcript-sync.mjs';
import { RepositoryService } from './repositories.mjs';
import { JsonStore, validateProjectPath } from './store.mjs';

const MIME = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const CHAT_MODELS = new Set(['sonnet', 'opus', 'haiku']);
const PERMISSION_MODES = new Set(['bypassPermissions', 'default']);

function apiError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

function validHost(request) {
  const host = String(request.headers.host || '').toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function configuredFrontendOrigin(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value !== value.trim()) throw new Error('CC_CHAT_FRONTEND_ORIGIN must be an exact HTTPS origin URL');
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname.includes('*') || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin === 'null') {
      throw new Error('invalid hosted origin');
    }
    return parsed.origin;
  } catch {
    throw new Error('CC_CHAT_FRONTEND_ORIGIN must be an exact HTTPS origin URL');
  }
}

function approvedOrigin(request, devOrigin, frontendOrigin, allowAnyOrigin) {
  if (!request.headers.origin) return { allowed: true, corsOrigin: '' };
  try {
    const origin = new URL(request.headers.origin);
    if ((origin.protocol !== 'http:' && origin.protocol !== 'https:') || origin.username || origin.password || request.headers.origin !== origin.origin) {
      return { allowed: false, corsOrigin: '' };
    }
    const normalized = origin.origin.toLowerCase();
    const sameOrigin = origin.host.toLowerCase() === String(request.headers.host).toLowerCase();
    const allowed = allowAnyOrigin || sameOrigin || normalized === devOrigin || origin.origin === frontendOrigin;
    return { allowed, corsOrigin: allowed ? origin.origin : '' };
  } catch {
    return { allowed: false, corsOrigin: '' };
  }
}

function setCorsHeaders(response, origin) {
  if (!origin) return;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
}

function preflight(request, response) {
  const method = String(request.headers['access-control-request-method'] || '').toUpperCase();
  const allowedMethods = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
  const requestedHeaders = String(request.headers['access-control-request-headers'] || '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedMethods.has(method) || requestedHeaders.some((header) => header !== 'content-type')) {
    return json(response, 403, { error: 'Forbidden preflight' });
  }
  response.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE');
  response.setHeader('access-control-allow-headers', 'Content-Type');
  if (String(request.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') {
    response.setHeader('access-control-allow-private-network', 'true');
  }
  response.writeHead(204);
  response.end();
}

async function body(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) throw apiError('Content-Type must be application/json', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw apiError('Request body is too large', 413);
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  }
  catch { throw apiError('Invalid JSON'); }
}

function value(value, name, maximum = 200_000) {
  if (typeof value !== 'string' || !value.trim()) throw apiError(`${name} is required`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw apiError(`${name} is too long`);
  return trimmed;
}

function findChat(state, id) {
  const chat = state.chats.find((item) => item.id === id);
  if (!chat) throw apiError('Chat not found', 404);
  return chat;
}

function projectFor(state, projectId) {
  if (projectId === null || projectId === undefined) return null;
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw apiError('Project not found', 400);
  return project;
}

function routeId(pathname, suffix = '') {
  const match = pathname.match(new RegExp(`^/api/chats/([^/]+)${suffix}$`));
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { throw apiError('Invalid URL encoding'); }
}

function nativeSessionId(pathname, suffix = '') {
  const match = pathname.match(new RegExp(`^/api/native-sessions/([^/]+)${suffix}$`));
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { throw apiError('Invalid URL encoding'); }
}

function makeBroadcaster(store) {
  const clients = new Set();
  let timer = null;
  let pending = null;
  const send = (client, state) => client.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  const unsubscribe = store.subscribe((state) => {
    pending = state;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const next = pending;
      pending = null;
      for (const client of clients) send(client, next);
    }, 40);
    timer.unref?.();
  });
  const keepalive = setInterval(() => { for (const client of clients) client.write(': keepalive\n\n'); }, 15_000);
  keepalive.unref?.();
  return {
    add(response) { clients.add(response); send(response, store.snapshot()); },
    remove(response) { clients.delete(response); },
    close() { unsubscribe(); clearInterval(keepalive); if (timer) clearTimeout(timer); for (const client of clients) client.end(); },
  };
}

async function serveSpa(request, response, distDir) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed' });
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { return json(response, 400, { error: 'Bad URL' }); }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let target = path.resolve(distDir, relative);
  const root = `${path.resolve(distDir)}${path.sep}`;
  if (!target.startsWith(root)) return json(response, 403, { error: 'Forbidden' });
  try {
    if (!(await stat(target)).isFile()) throw new Error('not file');
  } catch {
    target = path.resolve(distDir, 'index.html');
    try { await access(target); } catch { return json(response, 404, { error: 'Not found' }); }
  }
  const info = await stat(target);
  response.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream', 'content-length': info.size, 'x-content-type-options': 'nosniff' });
  if (request.method === 'HEAD') response.end(); else createReadStream(target).pipe(response);
}

export async function createApp(options = {}) {
  const frontendOrigin = configuredFrontendOrigin(options.frontendOrigin ?? process.env.CC_CHAT_FRONTEND_ORIGIN ?? '');
  const allowAnyOrigin = options.allowAnyOrigin === undefined
    ? process.env.CC_CHAT_ALLOW_ANY_ORIGIN === '1'
    : options.allowAnyOrigin === true;
  if (allowAnyOrigin) {
    console.warn('WARNING: allow-any-origin mode is enabled. Websites can read conversations and execute Claude commands, even while this server is bound to loopback.');
  }
  const cwd = path.resolve(options.cwd || process.cwd());
  const store = options.store || await new JsonStore({ dataDir: options.dataDir, cwd }).init();
  const runner = options.runner || new ClaudeRunner(options.runnerOptions);
  const nativeSessions = options.nativeSessions || new NativeSessionService(options.nativeSessionOptions);
  const repositories = options.repositories || new RepositoryService(options.repositoryOptions);
  const configuredDevOrigin = options.devOrigin ?? process.env.DEV_ORIGIN ?? '';
  let devOrigin = '';
  if (configuredDevOrigin) {
    try {
      const parsed = new URL(configuredDevOrigin);
      if (!isLoopbackHostname(parsed.hostname)) throw new Error('not loopback');
      devOrigin = parsed.origin.toLowerCase();
    } catch { throw new Error('DEV_ORIGIN must be an absolute loopback origin URL'); }
  }
  const distDir = path.resolve(options.distDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  const broadcaster = makeBroadcaster(store);
  const transcriptSync = new TranscriptSync({ store, nativeSessions, intervalMs: options.syncIntervalMs, auditMs: options.syncAuditMs });
  const historyLoads = new Map();

  async function loadChatHistory(chatId) {
    if (historyLoads.has(chatId)) return historyLoads.get(chatId);
    const operation = (async () => {
      const before = findChat(store.snapshot(), chatId);
      if (before.status === 'running') throw apiError('History cannot be loaded while a chat is running', 409);
      if (!before.nativeImported || !before.sessionId) throw apiError('Chat is not an imported native session', 409);
      const offset = before.historyNextOffset;
      if (offset === null || offset === undefined) return before;
      const page = await nativeSessions.messages(before.sessionId, { offset, limit: 100 });
      return store.update((state) => {
        const chat = findChat(state, chatId);
        if (chat.status === 'running') throw apiError('History cannot be loaded while a chat is running', 409);
        if (chat.historyNextOffset !== offset) return chat;
        const known = new Set(chat.messages.map((message) => message.history?.sourceUuid || message.id));
        const additions = page.messages.filter((message) => {
          const identity = message.history?.sourceUuid || message.id;
          if (!identity || known.has(identity)) return false;
          known.add(identity);
          return true;
        });
        const firstAppMessage = chat.messages.findIndex((message) => !message.history);
        const insertion = firstAppMessage < 0 ? chat.messages.length : firstAppMessage;
        chat.messages.splice(insertion, 0, ...additions);
        chat.historyNextOffset = page.nextOffset;
        chat.historyTruncated = page.nextOffset !== null;
        chat.updatedAt = new Date().toISOString();
        return chat;
      });
    })();
    historyLoads.set(chatId, operation);
    try { return await operation; }
    finally { if (historyLoads.get(chatId) === operation) historyLoads.delete(chatId); }
  }

  async function finishRun(chatId, assistantId, done) {
    const result = await done;
    await store.update((state) => {
      const chat = state.chats.find((item) => item.id === chatId);
      if (!chat) return null;
      const assistant = chat.messages.find((item) => item.id === assistantId);
      if (!assistant) return null;
      if (result.sessionId) chat.sessionId = result.sessionId;
      assistant.content = result.text || assistant.content;
      assistant.tools = result.tools?.length ? result.tools.map((tool) => ({ ...tool, status: 'complete' })) : assistant.tools;
      if (result.usage) assistant.usage = result.usage;
      if (result.sourceUuids?.length) assistant.nativeSourceIds = result.sourceUuids;
      if (result.launchFailed) {
        assistant.appOnly = true;
        const user = chat.messages[chat.messages.indexOf(assistant) - 1];
        if (user?.role === 'user') user.appOnly = true;
      }
      delete chat.sync;
      assistant.status = result.interrupted ? 'interrupted' : result.ok ? 'complete' : 'error';
      if (result.error && !result.interrupted) assistant.error = result.error;
      chat.status = 'idle';
      chat.updatedAt = new Date().toISOString();
      return chat;
    });
  }

  async function startRun(chatId, assistantId, prompt, launch) {
    let done;
    try {
      // Recheck native ownership immediately before launch, and retain the exact
      // native cwd even when the sidebar groups symlink aliases as one repo.
      const native = launch.sessionId ? await nativeSessions.resumable(launch.sessionId) : null;
      const launchState = store.snapshot();
      const chat = findChat(launchState, chatId);
      const assistant = chat.messages.find((message) => message.id === assistantId);
      if (chat.status !== 'running' || assistant?.status !== 'streaming') return;
      done = runner.run({
        chatId,
        sessionId: launch.sessionId,
        title: launch.title,
        model: launch.model,
        permissionMode: launch.permissionMode,
        cwd: native && launch.nativeImported ? native.cwd : launch.cwd,
        prompt,
        onUpdate(update) {
          void store.update((state) => {
            const current = state.chats.find((item) => item.id === chatId);
            const assistant = current?.messages.find((item) => item.id === assistantId);
            if (!assistant || current.status !== 'running') return null;
            if (update.sessionId) current.sessionId = update.sessionId;
            assistant.content = update.text;
            assistant.tools = update.tools;
            if (update.usage) assistant.usage = update.usage;
            if (update.sourceUuids?.length) assistant.nativeSourceIds = update.sourceUuids;
            current.updatedAt = new Date().toISOString();
            return null;
          }).catch(() => {});
        },
      });
    } catch (error) {
      done = Promise.resolve({ ok: false, launchFailed: true, error: error.message, text: '', tools: [] });
    }
    await finishRun(chatId, assistantId, done);
  }

  const handler = async (request, response) => {
    try {
      if (!validHost(request)) return json(response, 403, { error: 'Forbidden origin' });
      const origin = approvedOrigin(request, devOrigin, frontendOrigin, allowAnyOrigin);
      if (!origin.allowed) return json(response, 403, { error: 'Forbidden origin' });
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (!url.pathname.startsWith('/api/')) return serveSpa(request, response, distDir);
      setCorsHeaders(response, origin.corsOrigin);
      if (request.method === 'OPTIONS') {
        if (!origin.corsOrigin) return json(response, 403, { error: 'Forbidden preflight' });
        return preflight(request, response);
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        void transcriptSync.tick();
        return json(response, 200, store.snapshot());
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const health = await runner.health();
        return json(response, 200, { ok: true, ...health, cwd, ...(allowAnyOrigin ? { allowAnyOrigin: true } : {}) });
      }
      if (request.method === 'GET' && url.pathname === '/api/repositories') return json(response, 200, await repositories.list());
      if (request.method === 'GET' && url.pathname === '/api/native-sessions') {
        return json(response, 200, { sessions: await nativeSessions.list() });
      }
      const historySessionId = nativeSessionId(url.pathname, '/messages');
      if (historySessionId && request.method === 'GET') {
        const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : 0;
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 100;
        return json(response, 200, await nativeSessions.messages(historySessionId, { offset, limit }));
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        broadcaster.add(response);
        void transcriptSync.tick();
        response.once('close', () => broadcaster.remove(response));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/projects') {
        const input = await body(request);
        const projectPath = await validateProjectPath(input.path);
        const project = { id: randomUUID(), name: value(input.name, 'Project name', 200), path: projectPath, createdAt: new Date().toISOString() };
        const saved = await store.update((state) => {
          const existing = state.projects.find(item => (item.canonicalPath || item.path) === projectPath);
          if (existing) return existing;
          state.projects.push(project);
          return project;
        });
        return json(response, saved.id === project.id ? 201 : 200, saved);
      }
      if (request.method === 'POST' && url.pathname === '/api/chats') {
        const input = await body(request);
        const snapshot = store.snapshot();
        const projectId = input.projectId ?? null;
        projectFor(snapshot, projectId);
        const model = input.model ?? 'sonnet';
        const permissionMode = input.permissionMode ?? 'bypassPermissions';
        if (!CHAT_MODELS.has(model)) throw apiError('Invalid model');
        if (!PERMISSION_MODES.has(permissionMode)) throw apiError('Invalid permission mode');
        const now = new Date().toISOString();
        const title = input.title === undefined ? 'New chat' : value(input.title, 'Title', 500);
        const chat = { id: randomUUID(), title, projectId, sessionId: null, model, permissionMode, createdAt: now, updatedAt: now, messages: [], status: 'idle' };
        await store.update((state) => { state.chats.unshift(chat); return chat; });
        return json(response, 201, chat);
      }
      const importSessionId = nativeSessionId(url.pathname, '/import');
      if (importSessionId && request.method === 'POST') {
        const input = await body(request);
        const existing = store.snapshot().chats.find((chat) => chat.sessionId === importSessionId);
        if (existing) return json(response, 200, existing);
        const native = await nativeSessions.resumable(importSessionId);
        const projectPath = await validateProjectPath(native.cwd);
        const model = input.model ?? 'sonnet';
        const permissionMode = input.permissionMode ?? 'bypassPermissions';
        if (!CHAT_MODELS.has(model)) throw apiError('Invalid model');
        if (!PERMISSION_MODES.has(permissionMode)) throw apiError('Invalid permission mode');
        const history = await nativeSessions.messages(native.sessionId, { offset: 0, limit: 200 });
        const imported = await store.update((state) => {
          const alreadyImported = state.chats.find((chat) => chat.sessionId === native.sessionId);
          if (alreadyImported) return alreadyImported;
          let project = state.projects.find((item) => (item.canonicalPath || item.path) === projectPath);
          const now = new Date().toISOString();
          if (!project) {
            project = { id: randomUUID(), name: path.basename(projectPath) || projectPath, path: projectPath, createdAt: now };
            state.projects.push(project);
          }
          const startedAt = Number.isFinite(native.startedAt) ? new Date(native.startedAt).toISOString() : now;
          const chat = {
            id: randomUUID(),
            title: native.name || 'Claude session',
            projectId: project.id,
            sessionId: native.sessionId,
            model,
            permissionMode,
            createdAt: startedAt,
            updatedAt: now,
            messages: history.messages,
            status: 'idle',
            nativeImported: true,
            historyUnavailable: false,
            historyTruncated: history.nextOffset !== null,
            historyNextOffset: history.nextOffset,
          };
          state.chats.unshift(chat);
          return chat;
        });
        return json(response, 201, imported);
      }
      const renameNativeSessionId = nativeSessionId(url.pathname);
      if (renameNativeSessionId && request.method === 'PATCH') {
        const input = await body(request);
        if (Object.keys(input).some((key) => key !== 'title')) throw apiError('Unknown native session field');
        const title = value(input.title, 'Title', 500);
        const session = await nativeSessions.rename(renameNativeSessionId, title);
        const chat = await store.update((state) => {
          let updated = null;
          for (const current of state.chats) {
            if (current.sessionId === renameNativeSessionId) {
              current.title = title;
              current.updatedAt = new Date().toISOString();
              updated = current;
            }
          }
          return updated;
        });
        return json(response, 200, { session, chat });
      }
      const syncChatId = routeId(url.pathname, '/sync');
      if (syncChatId && request.method === 'POST') {
        await body(request);
        const chat = findChat(store.snapshot(), syncChatId);
        if (chat.status === 'running') throw apiError('Wait for the web response to finish before syncing', 409);
        await transcriptSync.syncChat(syncChatId, { force: true });
        return json(response, 200, findChat(store.snapshot(), syncChatId));
      }
      const historyChatId = routeId(url.pathname, '/history');
      if (historyChatId && request.method === 'POST') {
        await body(request);
        return json(response, 200, await loadChatHistory(historyChatId));
      }
      const chatId = routeId(url.pathname);
      if (chatId && request.method === 'PATCH') {
        const input = await body(request);
        const allowed = new Set(['title', 'projectId', 'model', 'permissionMode']);
        if (Object.keys(input).some((key) => !allowed.has(key))) throw apiError('Unknown chat field');
        const current = findChat(store.snapshot(), chatId);
        if ('title' in input) value(input.title, 'Title', 500);
        if ('model' in input && !CHAT_MODELS.has(input.model)) throw apiError('Invalid model');
        if ('permissionMode' in input && !PERMISSION_MODES.has(input.permissionMode)) throw apiError('Invalid permission mode');
        if ('projectId' in input) {
          const projectId = input.projectId ?? null;
          projectFor(store.snapshot(), projectId);
          if (current.status === 'running' && projectId !== current.projectId) throw apiError('Project cannot change while a chat is running', 409);
          if (current.sessionId && projectId !== current.projectId) throw apiError('Project cannot change after a Claude session has started', 409);
        }
        if ('title' in input && current.sessionId && input.title.trim() !== current.title) await nativeSessions.rename(current.sessionId, input.title.trim());
        const updated = await store.update((state) => {
          const chat = findChat(state, chatId);
          if ('title' in input) chat.title = value(input.title, 'Title', 500);
          if ('model' in input) { if (!CHAT_MODELS.has(input.model)) throw apiError('Invalid model'); chat.model = input.model; }
          if ('permissionMode' in input) { if (!PERMISSION_MODES.has(input.permissionMode)) throw apiError('Invalid permission mode'); chat.permissionMode = input.permissionMode; }
          if ('projectId' in input) {
            const projectId = input.projectId ?? null;
            projectFor(state, projectId);
            if (chat.status === 'running' && projectId !== chat.projectId) throw apiError('Project cannot change while a chat is running', 409);
            if (chat.sessionId && projectId !== chat.projectId) throw apiError('Project cannot change after a Claude session has started', 409);
            chat.projectId = projectId;
          }
          chat.updatedAt = new Date().toISOString();
          return chat;
        });
        return json(response, 200, updated);
      }
      if (chatId && request.method === 'DELETE') {
        await runner.stop(chatId);
        await store.update((state) => { const index = state.chats.findIndex((chat) => chat.id === chatId); if (index < 0) throw apiError('Chat not found', 404); state.chats.splice(index, 1); return null; });
        response.writeHead(204); response.end(); return;
      }
      const messageChatId = routeId(url.pathname, '/messages');
      if (messageChatId && request.method === 'POST') {
        const input = await body(request);
        const content = value(input.content, 'Message content');
        const beforeSend = findChat(store.snapshot(), messageChatId);
        if (beforeSend.status === 'running') throw apiError('Chat is already running', 409);
        if (beforeSend.nativeImported && beforeSend.historyNextOffset !== null && beforeSend.historyNextOffset !== undefined) {
          throw apiError('Load the complete native session history before sending a new message', 409);
        }
        if (beforeSend.sessionId) {
          await nativeSessions.resumable(beforeSend.sessionId);
          const synced = await transcriptSync.syncChat(messageChatId, { force: true });
          if (!synced || findChat(store.snapshot(), messageChatId).sync?.status === 'error') throw apiError('Resolve the Claude history sync error before sending a new message', 409);
        }
        const now = new Date().toISOString();
        const userMessage = { id: randomUUID(), role: 'user', content, createdAt: now, status: 'complete' };
        const assistant = { id: randomUUID(), role: 'assistant', content: '', createdAt: now, status: 'streaming', tools: [] };
        const accepted = await store.update((state) => {
          const current = findChat(state, messageChatId);
          if (current.status === 'running') throw apiError('Chat is already running', 409);
          current.messages.push(userMessage, assistant);
          delete current.sync;
          current.status = 'running'; current.updatedAt = now;
          const project = projectFor(state, current.projectId);
          return {
            chat: current,
            launch: {
              sessionId: current.sessionId,
              title: current.title,
              model: current.model,
              permissionMode: current.permissionMode,
              cwd: project?.path || cwd,
              nativeImported: Boolean(current.nativeImported),
            },
          };
        });
        json(response, 202, accepted.chat);
        void startRun(messageChatId, assistant.id, content, accepted.launch).catch(() => {});
        return;
      }
      const stopChatId = routeId(url.pathname, '/stop');
      if (stopChatId && request.method === 'POST') {
        await body(request);
        const exists = store.snapshot().chats.some((chat) => chat.id === stopChatId);
        if (!exists) throw apiError('Chat not found', 404);
        await runner.stop(stopChatId);
        await store.update((state) => {
          const chat = findChat(state, stopChatId);
          chat.status = 'idle';
          chat.updatedAt = new Date().toISOString();
          for (const message of chat.messages) if (message.status === 'streaming') message.status = 'interrupted';
          return null;
        });
        return json(response, 200, findChat(store.snapshot(), stopChatId));
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      if (!response.headersSent) json(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'Internal server error' });
      else response.destroy(error);
    }
  };
  handler.store = store;
  handler.runner = runner;
  handler.transcriptSync = transcriptSync;
  handler.close = async () => { broadcaster.close(); await transcriptSync.close(); await runner.stopAll?.(); };
  return handler;
}

export async function createServer(options = {}) {
  const app = await createApp(options);
  const server = http.createServer(app);
  server.app = app;
  server.on('close', () => { void app.close(); });
  return server;
}
