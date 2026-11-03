import { execFile } from 'node:child_process';

// Maps Claude session ids to the herdr session/pane that hosts them. herdr is optional:
// every failure (missing binary, timeout, bad JSON) degrades to "no herdr info".
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_SESSIONS = 200;
const MAX_AGENTS = 5_000;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function parseJson(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) return null;
  try { return JSON.parse(output); } catch { return null; }
}

function safeText(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && ![...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    ? value : null;
}

// `herdr session list --json` -> names of sessions that are running.
export function parseRunningSessions(output) {
  const value = parseJson(output);
  if (!value || !Array.isArray(value.sessions)) return [];
  const names = [];
  for (const record of value.sessions.slice(0, MAX_SESSIONS)) {
    if (!record || record.running !== true || typeof record.name !== 'string' || !NAME_PATTERN.test(record.name)) continue;
    if (!names.includes(record.name)) names.push(record.name);
  }
  return names;
}

// `herdr --session X agent list` -> [{ claudeSessionId, paneId, agentName }]
// Any agent kind that reports an id-kind agent_session counts (claude, codex, ...): the id is
// matched against this app's own session ids, so a kind that never matches is harmless.
export function parseAgents(output) {
  const value = parseJson(output);
  const agents = value?.result?.agents;
  if (!Array.isArray(agents)) return [];
  const found = [];
  for (const agent of agents.slice(0, MAX_AGENTS)) {
    if (!agent || typeof agent !== 'object' || typeof agent.agent !== 'string') continue;
    const session = agent.agent_session;
    if (!session || session.kind !== 'id') continue;
    const claudeSessionId = safeText(session.value, 200);
    if (!claudeSessionId) continue;
    found.push({
      claudeSessionId,
      paneId: safeText(agent.pane_id, 100),
      agentName: safeText(agent.name, 200) ?? safeText(agent.terminal_title_stripped, 200),
    });
  }
  return found;
}

// Builds Map<claudeSessionId, { herdrSession, paneId, agentName }>. When one id appears in
// several herdr sessions the first (in session list order) wins, deterministically.
export function buildSessionMap(perSession) {
  const map = new Map();
  for (const { session, agents } of perSession) {
    for (const agent of agents) {
      if (map.has(agent.claudeSessionId)) continue;
      map.set(agent.claudeSessionId, { herdrSession: session, paneId: agent.paneId, agentName: agent.agentName });
    }
  }
  return map;
}

export function annotateSessions(sessions, map) {
  return sessions.map((session) => {
    const info = map.get(session.sessionId) ?? map.get(session.id);
    if (!info) return session;
    return {
      ...session,
      herdrSession: info.herdrSession,
      ...(info.paneId ? { herdrPane: info.paneId } : {}),
      ...(info.agentName ? { herdrAgent: info.agentName } : {}),
    };
  });
}

function runHerdr(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile('herdr', args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout));
    });
  });
}

export function createHerdrSessions({ run = runHerdr, ttlMs = 8_000, timeoutMs = 3_000, now = Date.now } = {}) {
  let cached = null;
  let pending = null;

  async function load() {
    const sessions = parseRunningSessions(await run(['session', 'list', '--json'], timeoutMs));
    const perSession = await Promise.all(sessions.map(async (session) => ({
      session,
      agents: parseAgents(await run(['--session', session, 'agent', 'list'], timeoutMs)),
    })));
    return { sessions, map: buildSessionMap(perSession) };
  }

  return {
    // Never rejects; concurrent callers share one in-flight lookup.
    async snapshot() {
      if (cached && now() - cached.at < ttlMs) return cached.value;
      if (!pending) {
        pending = load().catch(() => ({ sessions: [], map: new Map() })).then((value) => {
          cached = { at: now(), value };
          return value;
        }).finally(() => { pending = null; });
      }
      return pending;
    },
  };
}
