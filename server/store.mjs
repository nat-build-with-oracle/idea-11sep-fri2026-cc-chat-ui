import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EMPTY_STATE_VERSION = 1;

function clone(value) {
  return structuredClone(value);
}

function interruptedState(state) {
  let changed = false;
  for (const chat of state.chats) {
    if (chat.status === 'running') {
      chat.status = 'idle';
      changed = true;
    }
    for (const message of chat.messages) {
      if (message.status === 'streaming') {
        message.status = 'interrupted';
        changed = true;
      }
      for (const tool of message.tools ?? []) {
        if (tool.status === 'running') {
          tool.status = 'complete';
          changed = true;
        }
      }
    }
  }
  return changed;
}

export class JsonStore {
  constructor({ dataDir = process.env.CC_CHAT_DATA_DIR || path.join(process.cwd(), '.local'), cwd = process.cwd() } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, 'state.json');
    this.cwd = path.resolve(cwd);
    this.state = null;
    this.queue = Promise.resolve();
    this.listeners = new Set();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.chats)) throw new Error('Invalid state shape');
      this.state = { version: EMPTY_STATE_VERSION, projects: parsed.projects, chats: parsed.chats };
      if (interruptedState(this.state)) await this.#write();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const createdAt = new Date().toISOString();
      this.state = {
        version: EMPTY_STATE_VERSION,
        projects: [{ id: randomUUID(), name: path.basename(this.cwd) || this.cwd, path: this.cwd, createdAt }],
        chats: [],
      };
      await this.#write();
    }
    // Canonical identity is separate from the historical execution path: Claude
    // may index native transcripts by the original (symlink) working directory.
    await Promise.all(this.state.projects.map(async (project) => {
      try { project.canonicalPath = await realpath(project.path); }
      catch { delete project.canonicalPath; } // Missing folders remain visible.
    }));
    return this;
  }

  snapshot() {
    if (!this.state) throw new Error('Store is not initialized');
    return clone({ projects: this.state.projects, chats: this.state.chats });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async update(mutator) {
    const operation = this.queue.then(async () => {
      const draft = clone(this.state);
      const result = await mutator(draft);
      await this.#write(draft);
      this.state = draft;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot);
      return clone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async #write(state = this.state) {
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

export async function validateProjectPath(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw Object.assign(new Error('Project path must be an absolute directory'), { statusCode: 400 });
  }
  try {
    const info = await stat(candidate);
    if (!info.isDirectory()) throw new Error('not a directory');
    return await realpath(candidate);
  } catch {
    throw Object.assign(new Error('Project path must be an existing directory'), { statusCode: 400 });
  }
}
