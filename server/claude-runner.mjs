import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const MAX_PENDING_LINE_BYTES = 8 * 1024 * 1024;

function textFromAssistant(message) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function toolsFromAssistant(message) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((block) => block?.type === 'tool_use')
    .map((block) => ({ id: block.id || randomUUID(), name: block.name || 'tool', input: block.input ?? {}, status: 'running' }));
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonnegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeUsage(usage, { scope = 'mainAgent', totalCostUsd } = {}) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const inputTokens = nonnegativeInteger(usage.input_tokens);
  const outputTokens = nonnegativeInteger(usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  const cacheReadInputTokens = nonnegativeInteger(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = nonnegativeInteger(usage.cache_creation_input_tokens);
  const costUsd = nonnegativeNumber(totalCostUsd);
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadInputTokens === null ? {} : { cacheReadInputTokens }),
    ...(cacheCreationInputTokens === null ? {} : { cacheCreationInputTokens }),
    ...(costUsd === null ? {} : { costUsd }),
    scope,
  };
}

function addTokenCount(total, value) {
  const count = nonnegativeInteger(value);
  if (count === null || !Number.isSafeInteger(total + count)) return null;
  return total + count;
}

function normalizeModelUsage(modelUsage, totalCostUsd) {
  if (!modelUsage || typeof modelUsage !== 'object' || Array.isArray(modelUsage)) return null;
  const rows = Object.values(modelUsage);
  if (rows.length === 0) return null;
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    for (const [target, source] of [
      ['inputTokens', 'inputTokens'],
      ['outputTokens', 'outputTokens'],
      ['cacheReadInputTokens', 'cacheReadInputTokens'],
      ['cacheCreationInputTokens', 'cacheCreationInputTokens'],
    ]) {
      const sum = addTokenCount(totals[target], row[source]);
      if (sum === null) return null;
      totals[target] = sum;
    }
  }
  const costUsd = nonnegativeNumber(totalCostUsd);
  return { ...totals, ...(costUsd === null ? {} : { costUsd }), scope: 'allModels' };
}

export function normalizeResultUsage(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  // modelUsage covers the main loop, subagents, sidechains, compaction, and
  // workflow agents. Older producers may only expose usage, which is scoped
  // to the main agent; do not attach the broader total_cost_usd to that fallback.
  return normalizeModelUsage(record.modelUsage, record.total_cost_usd)
    || normalizeUsage(record.usage, { scope: 'mainAgent' });
}

export class StreamNormalizer {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.text = '';
    this.segmentStart = null;
    this.currentSegment = '';
    this.assistantMessages = new Set();
    this.sourceUuids = new Set();
    this.tools = new Map();
    this.toolIndexes = new Map();
    this.toolJson = new Map();
    this.sessionId = null;
    this.protocolErrors = [];
    this.recordCount = 0;
    this.resultError = null;
    this.sawResult = false;
    this.usage = null;
  }

  push(chunk) {
    this.buffer += this.decoder.write(chunk);
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.#line(line);
    if (Buffer.byteLength(this.buffer) > MAX_PENDING_LINE_BYTES) {
      this.protocolErrors.push('[oversized unterminated stream line]');
      this.buffer = '';
    }
  }

  finish() {
    this.buffer += this.decoder.end();
    if (this.buffer.trim()) this.#line(this.buffer);
    this.buffer = '';
  }

  #line(line) {
    if (!line.trim()) return;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      this.protocolErrors.push(line);
      return;
    }
    this.recordCount += 1;
    if (typeof record.session_id === 'string') this.sessionId = record.session_id;
    if (record.type === 'stream_event') this.#streamEvent(record.event);
    if (record.type === 'assistant') {
      if (typeof record.uuid === 'string' && record.uuid) this.sourceUuids.add(record.uuid);
      const snapshot = textFromAssistant(record.message);
      const messageKey = record.message?.id || JSON.stringify(record.message?.content ?? []);
      if (snapshot && !this.assistantMessages.has(messageKey)) {
        if (this.segmentStart !== null) {
          this.text = `${this.text.slice(0, this.segmentStart)}${snapshot}`;
        } else {
          this.text += snapshot;
        }
        this.assistantMessages.add(messageKey);
      }
      this.segmentStart = null;
      this.currentSegment = '';
      for (const tool of toolsFromAssistant(record.message)) this.tools.set(tool.id, tool);
    }
    if (record.type === 'user') {
      const blocks = Array.isArray(record.message?.content) ? record.message.content : [];
      if (blocks.some(block => block?.type === 'tool_result') && typeof record.uuid === 'string' && record.uuid) this.sourceUuids.add(record.uuid);
      for (const block of blocks) {
        if (block?.type === 'tool_result' && block.tool_use_id && this.tools.has(block.tool_use_id)) this.tools.get(block.tool_use_id).status = 'complete';
      }
    }
    if (record.type === 'result') {
      this.sawResult = true;
      this.usage = normalizeResultUsage(record);
      const resultText = typeof record.result === 'string' ? record.result : '';
      if (resultText && (!this.text || resultText.startsWith(this.text))) this.text = resultText;
      if (record.is_error || (record.subtype && record.subtype !== 'success')) this.resultError = resultText || record.error || `Claude returned ${record.subtype}`;
      for (const tool of this.tools.values()) tool.status = 'complete';
    }
    this.#emit(record.type === 'result');
  }

  #streamEvent(event) {
    if (event?.type === 'message_start') {
      this.segmentStart = this.text.length;
      this.currentSegment = '';
    } else if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const delta = event.delta.text ?? '';
      if (this.segmentStart === null) this.segmentStart = this.text.length;
      this.currentSegment += delta;
      this.text += delta;
    } else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const block = event.content_block;
      const id = block.id || randomUUID();
      this.toolIndexes.set(event.index, id);
      this.tools.set(id, { id, name: block.name || 'tool', input: block.input ?? {}, status: 'running' });
    } else if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const id = this.toolIndexes.get(event.index);
      if (id) {
        const partial = `${this.toolJson.get(id) || ''}${event.delta.partial_json || ''}`;
        this.toolJson.set(id, partial);
        try { this.tools.get(id).input = JSON.parse(partial); } catch { /* Wait for the remaining JSON delta. */ }
      }
    }
  }

  #emit(final = false) {
    this.onUpdate({
      sessionId: this.sessionId,
      text: this.text,
      tools: [...this.tools.values()].map((tool) => structuredClone(tool)),
      ...(this.usage ? { usage: { ...this.usage } } : {}),
      ...(this.sourceUuids.size ? { sourceUuids: [...this.sourceUuids] } : {}),
      final,
    });
  }
}

export class ClaudeRunner {
  constructor({ spawnFn = spawn, execFileFn = execFile, command = process.env.CLAUDE_BIN || 'claude' } = {}) {
    this.spawnFn = spawnFn;
    this.execFileFn = execFileFn;
    this.command = command;
    this.running = new Map();
    this.healthPromise = null;
  }

  async health() {
    if (!this.healthPromise) {
      this.healthPromise = new Promise((resolve) => {
        try {
          this.execFileFn(this.command, ['--version'], { timeout: 3000 }, (error, stdout, stderr) => {
            resolve({ claudeAvailable: !error, claudeVersion: error ? null : String(stdout || stderr).trim() || null });
          });
        } catch {
          resolve({ claudeAvailable: false, claudeVersion: null });
        }
      });
    }
    return this.healthPromise;
  }

  run({ chatId, sessionId, title, model, permissionMode, cwd, prompt, onUpdate, env }) {
    if (this.running.has(chatId)) throw Object.assign(new Error('Chat is already running'), { statusCode: 409 });
    const selectedSessionId = sessionId || randomUUID();
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', model];
    if (permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
    else args.push('--permission-mode', 'default');
    if (typeof title === 'string' && title.trim()) args.push('--name', title.trim());
    if (sessionId) args.push('--resume', sessionId);
    else {
      args.push('--session-id', selectedSessionId);
    }

    const child = this.spawnFn(this.command, args, { cwd, ...(env ? { env } : {}), shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const normalizer = new StreamNormalizer(onUpdate);
    let stderr = '';
    let interrupted = false;
    child.stdout.on('data', (chunk) => normalizer.push(chunk));
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
    child.stdin.on('error', (error) => { stderr = `${stderr}\n${error.message}`.trim().slice(-16_384); });

    const done = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        normalizer.finish();
        this.running.delete(chatId);
        const malformed = normalizer.recordCount === 0 && normalizer.protocolErrors.length > 0;
        const missingResult = result.ok && !normalizer.sawResult;
        const ok = result.ok && !normalizer.resultError && !malformed && !missingResult;
        resolve({
          ...result,
          ok,
          error: result.error || normalizer.resultError || (malformed ? 'Claude returned malformed stream output' : null) || (missingResult ? 'Claude stream ended without a result event' : null),
          sessionId: normalizer.sessionId || (ok ? selectedSessionId : null),
          text: normalizer.text,
          tools: [...normalizer.tools.values()],
          ...(normalizer.usage ? { usage: { ...normalizer.usage } } : {}),
          ...(normalizer.sourceUuids.size ? { sourceUuids: [...normalizer.sourceUuids] } : {}),
        });
      };
      child.once('error', (error) => finish({ ok: false, interrupted, error: error.message, launchFailed: true }));
      child.once('close', (code, signal) => finish({
        ok: code === 0 && !interrupted,
        interrupted,
        error: interrupted ? 'Interrupted' : code === 0 ? null : stderr.trim() || `Claude exited with code ${code}${signal ? ` (${signal})` : ''}`,
      }));
    });
    this.running.set(chatId, { child, done, interrupt: () => { interrupted = true; } });
    child.stdin.end(prompt);
    return done;
  }

  async stop(chatId) {
    const entry = this.running.get(chatId);
    if (!entry) return false;
    entry.interrupt();
    try {
      if (entry.child.pid && process.platform !== 'win32') process.kill(-entry.child.pid, 'SIGINT');
      else entry.child.kill('SIGINT');
    } catch {
      entry.child.kill?.('SIGINT');
    }
    const terminate = setTimeout(() => {
      try {
        if (entry.child.pid && process.platform !== 'win32') process.kill(-entry.child.pid, 'SIGTERM');
        else entry.child.kill('SIGTERM');
      } catch { /* The child may already have exited. */ }
    }, 1500);
    terminate.unref?.();
    const force = setTimeout(() => {
      try {
        if (entry.child.pid && process.platform !== 'win32') process.kill(-entry.child.pid, 'SIGKILL');
        else entry.child.kill('SIGKILL');
      } catch { /* The child may already have exited. */ }
    }, 3000);
    force.unref?.();
    await entry.done;
    clearTimeout(terminate);
    clearTimeout(force);
    return true;
  }

  async stopAll() {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }
}
