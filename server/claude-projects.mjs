// Projects Claude Code has actually been used in, discovered from ~/.claude/projects.
//
// A second source alongside ghq. ghq answers "what repos exist"; this answers "where
// have I worked". Neither contains the other: a repo can exist with no history, and
// history can exist outside the ghq root — a plain home directory is a real example.
//
// The directory names look decodable and are not. Claude encodes a cwd by replacing
// '/', '.' and any non-ASCII character with '-', so
//   -opt-Code-github-com-Acme-thing---lab-ui
// can be /opt/Code/github.com/Acme/thing/ψ/lab/ui, and nothing in the name says which
// '-' was a '/', which was a '.', and which was 'ψ'. Guessing that apart is impossible,
// so the name is never parsed: the `cwd` field is read out of a transcript, where
// Claude wrote it verbatim.

import { readdir, stat, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_PROJECTS_DEFAULTS = {
  root: path.join(os.homedir(), '.claude', 'projects'),
  maxDirs: 2_000,
  maxTranscriptsScanned: 8,      // newest few per dir; the first usually answers
  maxHeadBytes: 256 * 1024,      // a cwd appears in the opening record
  // Whether to list a project whose directory no longer exists. Default false: a
  // vanished path cannot be opened, so offering it produces a click that always
  // fails. Set true to keep the history visible (rendered as unavailable).
  includeMissing: false,
};

const MAX_LINE_BYTES = 1024 * 1024; // one pathological line must not eat memory

/** First `cwd` in a JSONL transcript, or null. Reads a bounded head, never the file. */
async function readCwd(file, maxHeadBytes) {
  let handle;
  try {
    handle = await open(file, 'r');
    const { buffer, bytesRead } = await handle.read({ buffer: Buffer.alloc(maxHeadBytes), position: 0 });
    if (!bytesRead) return null;
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    // The last line may be cut off by the read window; drop it rather than misparse.
    if (bytesRead === maxHeadBytes) lines.pop();
    for (const line of lines) {
      if (!line || line.length > MAX_LINE_BYTES || !line.includes('"cwd"')) continue;
      try {
        const cwd = JSON.parse(line)?.cwd;
        if (typeof cwd === 'string' && path.isAbsolute(cwd)) return cwd;
      } catch { /* a partial or non-JSON line proves nothing; keep looking */ }
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Newest-first .jsonl files directly inside a project directory. */
async function transcripts(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const files = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => path.join(dir, e.name));
  const timed = await Promise.all(files.map(async file => {
    try { return { file, mtime: (await stat(file)).mtimeMs }; }
    catch { return null; }
  }));
  return timed.filter(Boolean).sort((a, b) => b.mtime - a.mtime);
}

const exists = async target => {
  try { return (await stat(target)).isDirectory(); }
  catch { return false; }
};

/**
 * Discover working directories that have Claude Code history.
 * Returns { root, projects: [{ path, sessions, lastActivity, missing }] }, newest first.
 *
 * Never throws: an absent ~/.claude/projects is a normal state for a fresh machine,
 * not an error worth surfacing, and yields { root: null, projects: [] }.
 */
export async function discoverClaudeProjects(options = {}) {
  const { root, maxDirs, maxTranscriptsScanned, maxHeadBytes, includeMissing } = { ...CLAUDE_PROJECTS_DEFAULTS, ...options };

  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { return { root: null, projects: [] }; }

  const found = new Map(); // cwd -> { sessions, lastActivity }

  await Promise.all(entries
    .filter(e => e.isDirectory() || e.isSymbolicLink())
    .slice(0, maxDirs)
    .map(async entry => {
      const files = await transcripts(path.join(root, entry.name));
      if (!files.length) return; // no transcript means no cwd to read, and we do not guess

      let cwd = null;
      for (const { file } of files.slice(0, maxTranscriptsScanned)) {
        cwd = await readCwd(file, maxHeadBytes);
        if (cwd) break;
      }
      if (!cwd) return;

      // Two encoded dirs can resolve to one cwd after a rename, so merge rather
      // than let the last writer win.
      const previous = found.get(cwd);
      found.set(cwd, {
        sessions: (previous?.sessions ?? 0) + files.length,
        lastActivity: Math.max(previous?.lastActivity ?? 0, files[0].mtime),
      });
    }));

  const checked = await Promise.all([...found.entries()].map(async ([cwd, value]) => ({
    path: cwd,
    ...value,
    missing: !(await exists(cwd)),
  })));

  return {
    root,
    projects: checked
      .filter(project => includeMissing || !project.missing)
      .sort((a, b) => b.lastActivity - a.lastActivity),
  };
}
