import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// A source fingerprint, not a comparison between raw JSONL and UI JSON.
export function transcriptHash(messages) {
  const source = messages.map(message => ({
    uuid: message.history?.sourceUuid || message.id,
    role: message.role,
    content: message.content,
    blocks: message.history?.blocks || [],
    parentToolUseId: message.history?.parentToolUseId || null,
    tools: message.tools || [],
    usage: message.usage || null,
  }));
  return createHash('sha256').update(JSON.stringify(canonical(source))).digest('hex');
}

const identity = message => message.history?.sourceUuid || message.id;
const human = message => message.role === 'user' && !message.history?.blocks.some(block => block.type === 'toolResult');
const conflict = () => new Error('Claude history could not be matched to saved messages. Your saved messages were kept; retry sync after the CLI finishes.');

function bind(message, records) {
  const first = records[0];
  const blocks = records.flatMap(record => record.history?.blocks || []);
  const tools = records.flatMap(record => record.tools || []);
  const merged = {
    ...first,
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    content: records.map(record => record.content).join(''),
    history: { ...first.history, blocks },
    nativeSourceIds: records.map(identity),
    ...(tools.length ? { tools } : {}),
  };
  // Live-run usage is a whole-turn total. Native records only carry API-message
  // usage; replacing that total would lose subagent cost or count it twice.
  if (message.usage && message.usage.scope !== 'apiMessage') merged.usage = message.usage;
  if (message.status === 'error' || message.status === 'interrupted') {
    merged.status = message.status;
    if (message.error) merged.error = message.error;
  }
  return merged;
}

/** Project a complete native snapshot without deleting unmatched app data.
 * Legacy app records have random IDs and aggregate several Claude records. Bind
 * those once, in order, then use native UUIDs exclusively on subsequent reads.
 */
export function reconcileMessages(saved, source) {
  const positions = new Map();
  source.forEach((record, index) => {
    const id = identity(record);
    if (!id || positions.has(id)) throw conflict();
    positions.set(id, index);
  });
  const replacements = new Map(), claimed = new Set(), local = new Map();
  let cursor = 0;
  for (const [savedIndex, message] of saved.entries()) {
    let indices;
    const following = saved[savedIndex + 1];
    const failedAttempt = !message.history && (['error', 'interrupted'].includes(message.status) || (message.role === 'user' && ['error', 'interrupted'].includes(following?.status)));
    const ids = message.nativeSourceIds || (message.history?.sourceUuid ? [message.history.sourceUuid] : null);
    const keepLocal = () => {
      const rows = local.get(cursor) || [];
      rows.push({ ...message, appOnly: true });
      local.set(cursor, rows);
    };
    // Programmatic CLI output can expose a streamed UUID that the Agent SDK does
    // not persist (notably built-in slash commands). Keep that response visible
    // without blocking later turns, but retry the binding if it appears later.
    if (message.appOnly && !(ids?.length && ids.every(id => positions.has(id)))) { keepLocal(); continue; }
    if (ids) {
      indices = ids.map(id => positions.get(id));
      if (!indices.length || indices.some(index => index === undefined)) {
        if (!message.history?.sourceUuid && ids.every(id => !positions.has(id))) { keepLocal(); continue; }
        throw conflict();
      }
    } else if (message.role === 'user') {
      const anchor = following?.nativeSourceIds?.length ? positions.get(following.nativeSourceIds[0]) : undefined;
      const candidates = source.flatMap((record, index) => {
        if (index < cursor || !human(record) || record.content !== message.content) return [];
        if (anchor !== undefined && (index >= anchor || source.slice(index + 1, anchor).some(human))) return [];
        return [index];
      });
      if (!candidates.length && failedAttempt) { keepLocal(); continue; }
      if (candidates.length !== 1) throw conflict();
      indices = candidates;
    } else {
      let end = cursor;
      while (end < source.length && !human(source[end])) end++;
      indices = Array.from({ length: end - cursor }, (_, index) => cursor + index);
      const records = indices.map(index => source[index]);
      const nativeTools = records.flatMap(record => record.tools || []).map(tool => tool.id).sort();
      const appTools = (message.tools || []).map(tool => tool.id).sort();
      if (!indices.length || records.map(record => record.content).join('') !== message.content || JSON.stringify(nativeTools) !== JSON.stringify(appTools)) {
        if (failedAttempt) { keepLocal(); continue; }
        throw conflict();
      }
    }
    if (indices.some(index => claimed.has(index)) || indices.some((index, i) => i && index <= indices[i - 1])) throw conflict();
    // Without a whole-turn total, keep the native records separate so every
    // API-message usage entry survives rather than keeping only the first.
    const grouped = indices.length > 1 && message.usage && message.usage.scope !== 'apiMessage';
    if (grouped && indices.some((index, i) => i && index !== indices[i - 1] + 1)) throw conflict();
    const bound = grouped ? indices : [indices[0]];
    for (const index of bound) claimed.add(index);
    replacements.set(indices[0], bind(message, bound.map(index => source[index])));
    cursor = Math.max(cursor, indices.at(-1) + 1);
  }
  const result = source.flatMap((record, index) => [
    ...(local.get(index) || []),
    ...(replacements.has(index) ? [replacements.get(index)] : claimed.has(index) ? [] : [bind(record, [record])]),
  ]);
  return [...result, ...(local.get(source.length) || [])];
}

export class TranscriptSync {
  constructor({ store, nativeSessions, canSyncChat = () => true, intervalMs = 2000, auditMs = 60_000, readTimeoutMs = 5000 }) {
    this.store = store;
    this.nativeSessions = nativeSessions;
    this.canSyncChat = canSyncChat;
    this.auditMs = auditMs;
    this.readTimeoutMs = readTimeoutMs;
    this.reads = new Map();
    this.failures = new Map();
    this.pending = new Map();
    this.tokens = new Map();
    this.closed = false;
    this.enabled = typeof nativeSessions.historySnapshot === 'function';
    if (this.enabled && intervalMs > 0) {
      this.timer = setInterval(() => void this.tick(), intervalMs);
      this.timer.unref?.();
      queueMicrotask(() => void this.tick());
    }
  }

  async tick() {
    if (this.closed || !this.enabled || this.ticking) return;
    this.ticking = true;
    try {
      const chats = this.store.snapshot().chats;
      const ids = new Set(chats.map(chat => chat.id));
      for (const id of this.tokens.keys()) if (!ids.has(id)) this.tokens.delete(id);
      for (const id of this.failures.keys()) if (!ids.has(id)) this.failures.delete(id);
      const queue = chats.filter(chat => chat.sessionId && chat.status !== 'running' && this.canSyncChat(chat));
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (!this.closed && queue.length) await this.syncChat(queue.shift().id).catch(() => {});
      }));
    } finally { this.ticking = false; }
  }

  async syncChat(chatId, { force = false } = {}) {
    if (!this.enabled) return true;
    if (this.closed) return false;
    if (!force && (this.failures.get(chatId)?.retryAt || 0) > Date.now()) return false;
    if (this.pending.has(chatId)) {
      const result = await this.pending.get(chatId);
      if (force && !this.closed) return this.syncChat(chatId, { force: true });
      return result;
    }
    const operation = this.#sync(chatId, force);
    this.pending.set(chatId, operation);
    try { return await operation; }
    finally { this.pending.delete(chatId); }
  }

  async #snapshot(sessionId, token) {
    let read = this.reads.get(sessionId);
    if (!read) {
      read = this.nativeSessions.historySnapshot(sessionId, token);
      this.reads.set(sessionId, read);
      const clear = () => { if (this.reads.get(sessionId) === read) this.reads.delete(sessionId); };
      read.then(clear, clear);
    }
    let timeout;
    try {
      return await Promise.race([read, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Claude history read timed out; saved messages were kept.')), this.readTimeoutMs);
      })]);
    } finally { clearTimeout(timeout); }
  }

  async #sync(chatId, force) {
    const before = this.store.snapshot().chats.find(chat => chat.id === chatId);
    if (!before?.sessionId || before.status === 'running' || !this.canSyncChat(before)) return false;
    const unchanged = chat => chat && this.canSyncChat(chat) && chat.sessionId === before.sessionId && chat.status !== 'running' && JSON.stringify(chat.messages) === JSON.stringify(before.messages);
    try {
      const cached = this.tokens.get(chatId);
      const token = !force && before.sync?.status === 'synced' && cached?.sessionId === before.sessionId && Date.now() - cached.auditedAt < this.auditMs ? cached.token : null;
      const snapshot = await this.#snapshot(before.sessionId, token);
      if (this.closed) return false;
      if (!snapshot) return before.sync?.status === 'synced';
      const messages = reconcileMessages(before.messages, snapshot.messages);
      const sourceHash = transcriptHash(snapshot.messages);
      const changed = JSON.stringify(messages) !== JSON.stringify(before.messages);
      const current = this.store.snapshot().chats.find(chat => chat.id === chatId);
      if (!unchanged(current)) return false;
      let applied = true;
      if (changed || before.sync?.sourceHash !== sourceHash || before.sync?.status !== 'synced' || before.historyTruncated) {
        applied = await this.store.update(state => {
          const chat = state.chats.find(chat => chat.id === chatId);
          if (this.closed || !unchanged(chat)) return false;
          chat.messages = messages;
          chat.historyNextOffset = null;
          chat.historyTruncated = false;
          chat.historyUnavailable = false;
          const checkedAt = new Date().toISOString();
          chat.sync = { status: 'synced', checkedAt, sourceHash, messageCount: snapshot.messages.length };
          if (changed) chat.updatedAt = checkedAt;
          return true;
        });
      }
      if (applied) {
        this.tokens.set(chatId, { sessionId: before.sessionId, token: snapshot.changeToken, auditedAt: Date.now() });
        this.failures.delete(chatId);
      }
      return applied;
    } catch (error) {
      if (this.closed) return;
      // Invalidate prior success on unstable reads too; pre-send must fail closed.
      const failures = (this.failures.get(chatId)?.count || 0) + 1;
      this.failures.set(chatId, { count: failures, retryAt: Date.now() + Math.min(30_000, 2000 * 2 ** Math.min(failures - 1, 4)) });
      this.tokens.delete(chatId);
      const detail = error.statusCode || error.message?.includes('saved messages') ? error.message : 'Unable to sync Claude history. Your saved messages were kept.';
      const current = this.store.snapshot().chats.find(chat => chat.id === chatId);
      if (!unchanged(current) || (current.sync?.status === 'error' && current.sync.error === detail)) return false;
      await this.store.update(state => {
        const chat = state.chats.find(chat => chat.id === chatId);
        if (this.closed || !unchanged(chat)) return;
        chat.sync = { ...chat.sync, status: 'error', checkedAt: new Date().toISOString(), error: detail };
      });
      this.tokens.delete(chatId);
      return false;
    }
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(this.pending.values());
    this.tokens.clear();
    this.failures.clear();
    this.reads.clear();
  }
}
