import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/app.mjs';

const HOST = '127.0.0.1';
const PORT = 4319;
const cwd = process.cwd();
const distDir = path.join(cwd, 'dist');

class SmokeRunner {
  constructor() {
    this.running = new Map();
  }

  health() {
    return Promise.resolve({ claudeAvailable: true, claudeVersion: 'smoke-fixture' });
  }

  run({ chatId, sessionId, prompt, onUpdate }) {
    if (this.running.has(chatId)) throw Object.assign(new Error('Chat is already running'), { statusCode: 409 });
    const selectedSessionId = sessionId || randomUUID();
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    const entry = {
      sessionId: selectedSessionId,
      finish: (result) => {
        clearTimeout(entry.timer);
        this.running.delete(chatId);
        finish(result);
      },
      timer: null,
    };
    this.running.set(chatId, entry);

    const normalized = prompt.trim().toLowerCase();
    const preview = normalized === 'wait' ? 'Waiting until you press Stop…' : 'Claude is thinking…';
    queueMicrotask(() => onUpdate({ sessionId: selectedSessionId, text: preview, tools: [] }));
    if (normalized === 'wait') return done;

    entry.timer = setTimeout(() => {
      if (normalized === 'fail') {
        entry.finish({ ok: false, interrupted: false, error: 'Smoke fixture failure', sessionId: selectedSessionId, text: '', tools: [] });
        return;
      }
      const text = `## Fixture reply\n\nYou said: **${prompt.trim()}**\n\n\`\`\`js\nconsole.log('smoke test')\n\`\`\``;
      const usage = { inputTokens: 120, outputTokens: 34, cacheReadInputTokens: 800, cacheCreationInputTokens: 80, costUsd: 0.001234, scope: 'allModels' };
      onUpdate({ sessionId: selectedSessionId, text, tools: [], usage });
      entry.finish({ ok: true, interrupted: false, sessionId: selectedSessionId, text, tools: [], usage });
    }, 700);
    entry.timer.unref?.();
    return done;
  }

  async stop(chatId) {
    const entry = this.running.get(chatId);
    if (!entry) return false;
    entry.finish({ ok: false, interrupted: true, error: 'Interrupted', sessionId: entry.sessionId, text: 'Stopped by smoke fixture.', tools: [] });
    return true;
  }

  async stopAll() {
    await Promise.all([...this.running.keys()].map((chatId) => this.stop(chatId)));
  }
}

function historyRecord(index) {
  const role = index % 2 === 0 ? 'user' : 'assistant';
  return {
    id: `fixture-history-${index + 1}`,
    role,
    content: role === 'user' ? `Historical request ${index + 1}` : `Historical **response ${index + 1}**`,
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
    status: 'complete',
    history: {
      sourceUuid: `fixture-source-${index + 1}`,
      parentToolUseId: null,
      blocks: [{ type: 'text', text: role === 'user' ? `Historical request ${index + 1}` : `Historical **response ${index + 1}**` }],
    },
  };
}

class SmokeNativeSessions {
  constructor() {
    this.stoppedName = 'Oracle archive — 235 messages';
    this.history = Array.from({ length: 235 }, (_, index) => historyRecord(index));
  }

  list() {
    return Promise.resolve([
      {
        id: 'fixture-active-agent', sessionId: 'fixture-active-session', cwd, kind: 'background',
        name: 'Maw peek digger', pid: 4242, startedAt: Date.UTC(2026, 8, 11, 11), state: 'working', status: null,
        waitingFor: 'Inspecting the Oracle family registry', action: 'openTerminal', terminalCommand: "claude attach 'fixture-active-agent'",
      },
      {
        id: 'fixture-stopped-session', sessionId: 'fixture-stopped-session', cwd, kind: 'saved',
        name: this.stoppedName, pid: null, startedAt: Date.UTC(2026, 8, 10, 11), state: 'saved', status: null,
        waitingFor: null, action: 'resume', terminalCommand: `cd '${cwd.replaceAll("'", "'\\''")}' && claude --resume 'fixture-stopped-session'`,
      },
    ]);
  }

  async resumable(sessionId) {
    const session = (await this.list()).find((item) => item.sessionId === sessionId);
    if (!session) throw Object.assign(new Error('Native Claude session not found'), { statusCode: 404 });
    if (session.action !== 'resume') throw Object.assign(new Error('Native Claude session is active; use its terminal instead'), { statusCode: 409 });
    return session;
  }

  async messages(sessionId, { offset = 0, limit = 100 } = {}) {
    if (sessionId !== 'fixture-stopped-session' && sessionId !== 'fixture-active-session') {
      throw Object.assign(new Error('Native Claude session not found'), { statusCode: 404 });
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw Object.assign(new Error('Invalid fixture history page'), { statusCode: 400 });
    }
    const source = sessionId === 'fixture-stopped-session' ? this.history : [
      ...this.history.slice(0, 4),
      {
        id: 'fixture-tool-only', role: 'assistant', content: '', status: 'complete', createdAt: '',
        usage: { inputTokens: 20, outputTokens: 10, scope: 'apiMessage' },
        history: { sourceUuid: 'fixture-tool-only', blocks: [{ type: 'tool', id: 'fixture-tool', name: 'Read', input: { file_path: '/fixture/README.md' }, status: 'complete' }] },
      },
    ];
    const messages = source.slice(offset, offset + limit);
    return { messages, nextOffset: offset + limit < source.length ? offset + limit : null };
  }

  async rename(sessionId, title) {
    if (sessionId === 'fixture-active-session') {
      throw Object.assign(new Error('Native Claude session is active; use its terminal instead'), { statusCode: 409 });
    }
    if (title.trim().toLowerCase() === 'fail') throw Object.assign(new Error('Smoke fixture rename failure'), { statusCode: 502 });
    if (sessionId === 'fixture-stopped-session') {
      if (title === 'slow-rename') await new Promise((resolve) => setTimeout(resolve, 3000));
      this.stoppedName = title;
      return (await this.list()).find((item) => item.sessionId === sessionId);
    }
    return {
      id: sessionId, sessionId, cwd, kind: 'saved', name: title, pid: null, startedAt: Date.now(),
      state: 'saved', status: null, waitingFor: null, action: 'resume',
      terminalCommand: `cd '${cwd.replaceAll("'", "'\\''")}' && claude --resume '${sessionId}'`,
    };
  }
}

await access(path.join(distDir, 'index.html')).catch(() => {
  throw new Error('Built UI not found. Run `npm run build` before starting the smoke server.');
});

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cc-chat-smoke-'));
const server = await createServer({
  cwd,
  dataDir,
  distDir,
  runner: new SmokeRunner(),
  nativeSessions: new SmokeNativeSessions(),
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.app.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}

server.on('error', async (error) => {
  console.error(`Smoke server failed: ${error.message}`);
  await rm(dataDir, { recursive: true, force: true });
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Claude Chat UI smoke fixture listening on http://${HOST}:${PORT}`);
  console.log('Fake commands: ordinary prompt = delayed reply; "wait" = runs until Stop; "fail" = assistant error.');
  console.log('Native fixtures: "Oracle archive — 235 messages" is resumable; "Maw peek digger" is active and guarded.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await close();
    process.exit(0);
  });
}
