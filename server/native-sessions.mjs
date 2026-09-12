import { execFile } from 'node:child_process';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import * as claudeSdk from '@anthropic-ai/claude-agent-sdk';
import { normalizeUsage } from './claude-runner.mjs';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const ACTIVE_BACKGROUND_STATES = new Set(['working', 'blocked']);
const RESUMABLE_BACKGROUND_STATES = new Set(['done', 'completed', 'failed', 'stopped']);
const ACTIVE_STATUSES = new Set(['busy', 'waiting', 'idle']);

function shortString(value, maximum = 500) {
  return typeof value === 'string' ? value.slice(0, maximum) : null;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function timestamp(value) {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function normalize(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const kind = record.kind === 'interactive' || record.kind === 'background' ? record.kind : null;
  const cwd = shortString(record.cwd, 4096);
  if (!kind || !cwd || !path.isAbsolute(cwd)) return null;
  const sessionId = shortString(record.sessionId, 200);
  const state = shortString(record.state, 100);
  const status = shortString(record.status, 100);
  const pid = positiveInteger(record.pid);
  const id = shortString(record.id, 200);
  const active = Boolean(pid) || (kind === 'background' && ACTIVE_BACKGROUND_STATES.has(state)) || (kind === 'interactive' && ACTIVE_STATUSES.has(status));
  const resumable = Boolean(sessionId) && !active && (kind !== 'background' || RESUMABLE_BACKGROUND_STATES.has(state));
  const action = active && kind === 'background' && id ? 'openTerminal'
    : active && kind === 'interactive' && sessionId ? 'resumeAfterExit'
      : resumable ? 'resume' : 'unavailable';
  const terminalCommand = action === 'openTerminal' ? `claude attach ${shellQuote(id)}`
    : (action === 'resume' || action === 'resumeAfterExit') ? `cd ${shellQuote(path.resolve(cwd))} && claude --resume ${shellQuote(sessionId)}`
      : null;
  return {
    id,
    cwd: path.resolve(cwd),
    kind,
    name: shortString(record.name, 500),
    pid,
    sessionId,
    startedAt: timestamp(record.startedAt),
    updatedAt: timestamp(record.updatedAt) ?? timestamp(record.lastModified) ?? timestamp(record.startedAt),
    state,
    status,
    waitingFor: shortString(record.waitingFor, 500),
    action,
    terminalCommand,
  };
}

function normalizeSaved(record) {
  const sessionId = shortString(record?.sessionId, 200);
  const cwd = shortString(record?.cwd, 4096);
  if (!sessionId || !cwd || !path.isAbsolute(cwd)) return null;
  const resolvedCwd = path.resolve(cwd);
  return {
    id: sessionId,
    cwd: resolvedCwd,
    kind: 'saved',
    name: shortString(record.customTitle || record.summary || record.firstPrompt, 500),
    pid: null,
    sessionId,
    startedAt: timestamp(record.createdAt) ?? timestamp(record.lastModified),
    updatedAt: timestamp(record.lastModified) ?? timestamp(record.createdAt),
    state: 'saved',
    status: null,
    waitingFor: null,
    action: 'resume',
    terminalCommand: `cd ${shellQuote(resolvedCwd)} && claude --resume ${shellQuote(sessionId)}`,
  };
}

function safeUnknown(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return String(value); }
}

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(safeUnknown(content));
  return content.map((block) => typeof block === 'string' ? block : block?.text || '').filter(Boolean).join('\n');
}

function messageTime(record, fallback) {
  const candidate = record?.timestamp ?? record?.message?.timestamp ?? fallback;
  const date = typeof candidate === 'string' || Number.isFinite(candidate) ? new Date(candidate) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function sessionChangeToken(info) {
  return JSON.stringify([info.lastModified ?? null, info.fileSize ?? null, info.cwd ?? null]);
}

function visibleText(text) {
  const command = text.match(/^\s*<command-name>(\/[\s\S]*?)<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>\s*$/);
  if (!command) return text;
  const name = command[1].trim();
  const args = command[2].trim();
  return args ? `${name} ${args}` : name;
}

function normalizeHistoryMessage(record, fallbackTime) {
  if (!record || (record.type !== 'user' && record.type !== 'assistant')) return null;
  const message = record.message && typeof record.message === 'object' ? record.message : {};
  const source = Array.isArray(message.content) ? message.content : [{ type: 'text', text: typeof message.content === 'string' ? message.content : '' }];
  const blocks = [];
  const tools = [];
  const text = [];
  for (const block of source) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text });
      text.push(block.text);
    } else if (block?.type === 'tool_use') {
      const tool = { id: shortString(block.id, 500) || `history-tool-${blocks.length}`, name: shortString(block.name, 500) || 'tool', input: safeUnknown(block.input ?? {}), status: 'complete' };
      blocks.push({ type: 'tool', ...tool });
      tools.push(tool);
    } else if (block?.type === 'tool_result') {
      blocks.push({ type: 'toolResult', toolUseId: shortString(block.tool_use_id, 500), content: blockText(block.content), isError: Boolean(block.is_error) });
    }
  }
  // Streamed Claude assistant records can repeat an incomplete usage snapshot
  // for every content block. Only a completed API message has authoritative
  // per-message usage; terminal CLI result records are not exposed by this SDK.
  const usage = record.type === 'assistant' && message.stop_reason != null
    ? normalizeUsage(message.usage, { scope: 'apiMessage' })
    : null;
  return {
    id: shortString(record.uuid, 500) || `${record.session_id || 'history'}-${fallbackTime}`,
    role: record.type,
    content: visibleText(text.join('')),
    createdAt: messageTime(record, fallbackTime),
    status: 'complete',
    ...(tools.length ? { tools } : {}),
    ...(usage ? { usage } : {}),
    history: {
      sourceUuid: shortString(record.uuid, 500),
      parentToolUseId: shortString(record.parent_tool_use_id, 500),
      blocks,
    },
  };
}

export class NativeSessionService {
  constructor({ execFileFn = execFile, sdk = claudeSdk, command = process.env.CLAUDE_BIN || 'claude', timeout = 5000 } = {}) {
    this.execFileFn = execFileFn;
    this.command = command;
    this.timeout = timeout;
    this.sdk = sdk;
    this.mutationQueue = Promise.resolve();
  }

  async list() {
    const [activeResult, savedResult] = await Promise.allSettled([this.#listActive(), this.#listSaved()]);
    if (activeResult.status === 'rejected' && savedResult.status === 'rejected') throw activeResult.reason;
    const saved = savedResult.status === 'fulfilled' ? savedResult.value : [];
    const active = activeResult.status === 'fulfilled' ? activeResult.value : [];
    if (activeResult.status === 'rejected') {
      for (const session of saved) {
        session.action = 'unavailable';
        session.status = 'liveStatusUnknown';
      }
    }
    const sessions = new Map(saved.map((session) => [session.sessionId, session]));
    for (const session of active) {
      const prior = session.sessionId ? sessions.get(session.sessionId) : null;
      if (prior) {
        // An attached background job also appears as an interactive process.
        // Keep its job identity, but retain the strongest active-owner guard.
        const background = [prior, session].find((entry) => entry.kind === 'background');
        const owner = [prior, session].find((entry) => entry.action === 'resumeAfterExit')
          || [prior, session].find((entry) => entry.action === 'openTerminal');
        const updatedAt = Math.max(prior.updatedAt || 0, session.updatedAt || 0) || null;
        const merged = { ...prior, ...session, ...(background || {}), name: background?.name || session.name || prior.name, updatedAt };
        if (owner) Object.assign(merged, { action: owner.action, terminalCommand: owner.terminalCommand, pid: owner.pid || merged.pid });
        sessions.set(session.sessionId, merged);
      }
      else sessions.set(session.sessionId || `active:${session.kind}:${session.id || session.pid}`, session);
    }
    const result = [...sessions.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const paths = new Map();
    await Promise.all([...new Set(result.map(session => session.cwd))].map(async cwd => {
      try { paths.set(cwd, await realpath(cwd)); } catch { /* Keep sessions from missing folders. */ }
    }));
    for (const session of result) {
      if (paths.has(session.cwd)) session.canonicalPath = paths.get(session.cwd);
    }
    return result;
  }

  async #listActive() {
    const output = await new Promise((resolve, reject) => {
      const callback = (error, stdout) => {
        if (error) return reject(Object.assign(new Error('Unable to list native Claude sessions'), { statusCode: 503, cause: error }));
        resolve(String(stdout));
      };
      try {
        this.execFileFn(this.command, ['agents', '--json', '--all'], { timeout: this.timeout, maxBuffer: MAX_OUTPUT_BYTES }, callback);
      } catch (error) {
        reject(Object.assign(new Error('Unable to list native Claude sessions'), { statusCode: 503, cause: error }));
      }
    });
    let records;
    try { records = JSON.parse(output); }
    catch { throw Object.assign(new Error('Claude returned invalid native session data'), { statusCode: 502 }); }
    if (!Array.isArray(records)) throw Object.assign(new Error('Claude returned invalid native session data'), { statusCode: 502 });
    return records.map(normalize).filter(Boolean);
  }

  async #listSaved() {
    try {
      return (await this.sdk.listSessions({ limit: 500, offset: 0, includeProgrammatic: true })).map(normalizeSaved).filter(Boolean);
    } catch (error) {
      throw Object.assign(new Error('Unable to list saved Claude sessions'), { statusCode: 503, cause: error });
    }
  }

  async resumable(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw Object.assign(new Error('Invalid native session id'), { statusCode: 400 });
    const session = (await this.list()).find((entry) => entry.sessionId === sessionId);
    if (!session) throw Object.assign(new Error('Native Claude session not found'), { statusCode: 404 });
    if (session.action === 'openTerminal' || session.action === 'resumeAfterExit') {
      const owner = session.status === 'idle' ? 'An idle Claude terminal still holds this session' : 'Another Claude process still holds this session';
      const pid = session.pid ? ` (PID ${session.pid})` : '';
      throw Object.assign(new Error(`${owner}${pid}. Its last turn may be done, but the process has not exited. Use that terminal, or exit it before sending here. History sync remains available.`), { statusCode: 409 });
    }
    if (session.action !== 'resume') throw Object.assign(new Error('Native Claude session cannot be resumed'), { statusCode: 409 });
    return session;
  }

  async messages(sessionId, { offset = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw Object.assign(new Error('Invalid message offset'), { statusCode: 400 });
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw Object.assign(new Error('Message limit must be between 1 and 200'), { statusCode: 400 });
    const session = (await this.list()).find((entry) => entry.sessionId === sessionId);
    if (!session) throw Object.assign(new Error('Native Claude session not found'), { statusCode: 404 });
    let source;
    try {
      source = await this.sdk.getSessionMessages(sessionId, { offset, limit: limit + 1 });
    } catch (error) {
      throw Object.assign(new Error('Unable to read native Claude session history'), { statusCode: 502, cause: error });
    }
    if (!Array.isArray(source)) throw Object.assign(new Error('Claude SDK returned invalid session history'), { statusCode: 502 });
    const hasMore = source.length > limit;
    const fallback = session.startedAt || 0;
    const messages = source.slice(0, limit).map((message, index) => normalizeHistoryMessage(message, fallback + index)).filter(Boolean);
    return { messages, nextOffset: hasMore ? offset + limit : null };
  }

  async historySnapshot(sessionId, previousToken = null) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw Object.assign(new Error('Invalid native session id'), { statusCode: 400 });
    let before;
    try {
      before = await this.sdk.getSessionInfo(sessionId);
    } catch (error) {
      throw Object.assign(new Error('Unable to read native Claude session metadata'), { statusCode: 502, cause: error });
    }
    if (!before) throw Object.assign(new Error('Native Claude session not found'), { statusCode: 404 });
    const changeToken = sessionChangeToken(before);
    if (previousToken === changeToken) return null;

    let source;
    try {
      source = await this.sdk.getSessionMessages(sessionId, { limit: 10_001 });
    } catch (error) {
      throw Object.assign(new Error('Unable to read native Claude session history'), { statusCode: 502, cause: error });
    }
    if (!Array.isArray(source)) throw Object.assign(new Error('Claude SDK returned invalid session history'), { statusCode: 502 });
    if (source.length > 10_000) throw Object.assign(new Error('Native Claude session history exceeds the safe snapshot limit'), { statusCode: 413 });

    let after;
    try {
      after = await this.sdk.getSessionInfo(sessionId);
    } catch (error) {
      throw Object.assign(new Error('Unable to verify native Claude session metadata'), { statusCode: 502, cause: error });
    }
    if (!after || sessionChangeToken(after) !== changeToken) {
      throw Object.assign(new Error('Native Claude session changed while history was being read'), { statusCode: 409, transient: true });
    }
    const fallback = before.createdAt ?? before.lastModified ?? 0;
    return {
      changeToken,
      messages: source.map((message, index) => normalizeHistoryMessage(message, fallback + index)).filter(Boolean),
    };
  }

  async rename(sessionId, title) {
    const operation = this.mutationQueue.then(() => this.#rename(sessionId, title));
    this.mutationQueue = operation.catch(() => {});
    return operation;
  }

  async #rename(sessionId, title) {
    const session = (await this.list()).find((entry) => entry.sessionId === sessionId);
    if (!session) throw Object.assign(new Error('Native Claude session not found'), { statusCode: 404 });
    if (session.action !== 'resume') throw Object.assign(new Error('Native Claude session cannot be safely renamed while live ownership is unknown or active'), { statusCode: 409 });
    try {
      await this.sdk.renameSession(sessionId, title, { dir: session.cwd });
    } catch (error) {
      throw Object.assign(new Error('Unable to rename native Claude session'), { statusCode: 502, cause: error });
    }
    let refreshed;
    try { refreshed = await this.sdk.getSessionInfo?.(sessionId, { dir: session.cwd }); }
    catch { /* Rename succeeded; a metadata refresh failure must not report otherwise. */ }
    return { ...session, name: shortString(refreshed?.customTitle || refreshed?.summary, 500) || title };
  }
}
