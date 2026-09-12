import { execFile } from 'node:child_process';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const MAX_ANCESTRY_DEPTH = 64;
const TMUX_FORMAT = '#{pane_id}\t#{pane_pid}\t#{session_id}\t#{window_id}\t#{pane_dead}';
const CLOSED_MESSAGE = 'Terminal closed or unavailable. Refresh ARRA or explicitly resume the saved session.';

function positiveInteger(value) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function ownerPid(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeString(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && ![...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    ? value
    : null;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function attachCommand(sessionName) {
  return `if tmux has-session -t ${shellQuote(`=${sessionName}`)} 2>/dev/null; then maw a ${shellQuote(sessionName)}; else printf '%s\\n' ${shellQuote(CLOSED_MESSAGE)}; false; fi`;
}

function parseMaw(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) return null;
  let value;
  try { value = JSON.parse(output); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.scope !== 'local'
    || !Array.isArray(value.panes) || value.panes.length > MAX_RECORDS) return null;

  const panes = new Map();
  const ambiguous = new Set();
  for (const record of value.panes) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const paneId = typeof record.id === 'string' && /^%\d+$/.test(record.id) ? record.id : null;
    const sessionName = safeString(record.session, 200);
    const target = safeString(record.target, 500);
    if (!paneId || !sessionName || sessionName.startsWith('-') || sessionName.includes(':') || !target) continue;
    if (panes.has(paneId)) {
      panes.delete(paneId);
      ambiguous.add(paneId);
      continue;
    }
    if (!ambiguous.has(paneId)) {
      panes.set(paneId, {
        sessionName,
        target,
        paneId,
        attachCommand: attachCommand(sessionName),
      });
    }
  }
  return panes;
}

function parseTmux(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) return null;
  const lines = output === '' ? [] : output.replace(/\n$/, '').split('\n');
  if (lines.length > MAX_RECORDS) return null;
  const byRootPid = new Map();
  const paneIds = new Set();
  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length !== 5) return null;
    const [paneId, panePidText, sessionId, windowId, paneDead] = fields;
    const panePid = positiveInteger(panePidText);
    if (!/^%\d+$/.test(paneId) || !panePid || !/^\$\d+$/.test(sessionId)
      || !/^@\d+$/.test(windowId) || !/^[01]$/.test(paneDead)) return null;
    if (paneDead === '1') continue;
    if (paneIds.has(paneId)) return null;
    paneIds.add(paneId);
    const existing = byRootPid.get(panePid);
    if (existing === undefined) byRootPid.set(panePid, paneId);
    else if (existing !== paneId) byRootPid.set(panePid, null);
  }
  return byRootPid;
}

function parsePs(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) return null;
  const lines = output.trim() ? output.trim().split('\n') : [];
  if (lines.length > MAX_RECORDS) return null;
  const parents = new Map();
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!match) return null;
    const pid = positiveInteger(match[1]);
    const ppid = Number(match[2]);
    if (!pid || !Number.isSafeInteger(ppid) || ppid < 0 || parents.has(pid)) return null;
    parents.set(pid, ppid);
  }
  return parents;
}

function run(execFileFn, command, args, timeout) {
  return new Promise((resolve, reject) => {
    const callback = (error, stdout) => error ? reject(error) : resolve(String(stdout));
    try {
      execFileFn(command, args, { timeout, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' }, callback);
    } catch (error) {
      reject(error);
    }
  });
}

export class MawTerminalService {
  constructor({ execFileFn = execFile, timeout = 1500, cacheMs = 2000, now = Date.now } = {}) {
    this.execFileFn = execFileFn;
    this.timeout = Number.isFinite(timeout) ? Math.max(1, Math.min(2000, Math.trunc(timeout))) : 1500;
    this.cacheMs = Number.isFinite(cacheMs) ? Math.max(0, Math.min(2000, Math.trunc(cacheMs))) : 2000;
    this.now = now;
    this.cache = null;
    this.cacheSet = false;
    this.cacheTime = -Infinity;
    this.inflight = null;
  }

  async locate(pids) {
    if (!Array.isArray(pids)) return new Map();
    const owners = [...new Set(pids.map(ownerPid).filter(Boolean))].slice(0, MAX_RECORDS);
    if (owners.length === 0) return new Map();
    const inventory = await this.#inventory();
    if (!inventory) return new Map();

    const result = new Map();
    for (const ownerPid of owners) {
      if (!inventory.parents.has(ownerPid)) continue;
      let pid = ownerPid;
      const seen = new Set();
      let matched = null;
      let invalid = false;
      for (let depth = 0; depth <= MAX_ANCESTRY_DEPTH; depth += 1) {
        if (seen.has(pid)) { invalid = true; break; }
        seen.add(pid);
        if (inventory.byRootPid.has(pid)) {
          const paneId = inventory.byRootPid.get(pid);
          if (paneId) matched = inventory.mawPanes.get(paneId) || null;
          break;
        }
        if (depth === MAX_ANCESTRY_DEPTH) { invalid = true; break; }
        const parent = inventory.parents.get(pid);
        if (!Number.isSafeInteger(parent) || parent <= 0) break;
        pid = parent;
      }
      if (!invalid && matched) result.set(ownerPid, { ...matched });
    }
    return result;
  }

  async #inventory() {
    const now = this.now();
    if (this.cacheSet && now - this.cacheTime < this.cacheMs) return this.cache;
    if (this.inflight) return this.inflight;
    this.inflight = this.#refresh().then((inventory) => {
      this.cache = inventory;
      this.cacheSet = true;
      this.cacheTime = this.now();
      return inventory;
    }).catch(() => {
      this.cache = null;
      this.cacheSet = true;
      this.cacheTime = this.now();
      return null;
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async #refresh() {
    const [mawOutput, tmuxOutput, psOutput] = await Promise.all([
      run(this.execFileFn, 'maw', ['ls', '--verbose', '--json'], this.timeout),
      run(this.execFileFn, 'tmux', ['list-panes', '-a', '-F', TMUX_FORMAT], this.timeout),
      run(this.execFileFn, 'ps', ['-axo', 'pid=,ppid='], this.timeout),
    ]);
    const mawPanes = parseMaw(mawOutput);
    const byRootPid = parseTmux(tmuxOutput);
    const parents = parsePs(psOutput);
    if (!mawPanes || !byRootPid || !parents) throw new Error('Invalid terminal inventory');
    return { mawPanes, byRootPid, parents };
  }
}
