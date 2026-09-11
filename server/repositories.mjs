import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CACHE_TTL = 60_000;
const DEFAULT_TIMEOUT = 2_000;
const DEFAULT_MAX_CANDIDATES = 5_000;
const DEFAULT_MAX_REPOSITORIES = 1_000;
const DEFAULT_MAX_RECENCY_ENTRIES = 1_000;
const DEFAULT_MAX_DIRECTORIES = 20_000;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_CONCURRENCY = 16;
const EXCLUDED_RECENCY_NAMES = new Set(['node_modules', '.git', 'dist', '.local', 'cache']);
const EXCLUDED_TRAVERSAL_NAMES = new Set([
  '.git', '.local', '.cache', 'cache', 'node_modules', 'dist',
]);

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function boundedMap(values, concurrency, mapper) {
  const output = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

async function childDirectoryPaths(parents, concurrency) {
  const groups = await boundedMap(parents, concurrency, async (parent) => {
    let entries;
    try { entries = await readdir(parent, { withFileTypes: true }); }
    catch { return []; }
    return entries
      .filter((entry) => !EXCLUDED_TRAVERSAL_NAMES.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()))
      .map((entry) => path.join(parent, entry.name))
      .sort();
  });
  return groups.flat();
}

async function resolveDirectories(candidates, root, concurrency) {
  const resolved = await boundedMap(candidates, concurrency, async (candidate) => {
    try {
      const canonical = await realpath(candidate);
      if (!inside(root, canonical) || !(await stat(canonical)).isDirectory()) return null;
      return canonical;
    } catch { return null; }
  });
  return resolved.filter(Boolean);
}

async function isRepository(candidate) {
  try {
    const marker = await lstat(path.join(candidate, '.git'));
    return marker.isDirectory() || marker.isFile();
  } catch { return false; }
}

async function modifiedAt(repository, concurrency, maximumEntries) {
  // Recency is filesystem-only: the repository directory plus its immediate
  // children. Nested contents are intentionally not walked, and common bulky
  // or generated top-level trees are excluded. This is not git commit recency.
  let maximum = 0;
  try { maximum = (await stat(repository)).mtimeMs; }
  catch { return { value: maximum, truncated: false }; }
  let entries;
  try { entries = await readdir(repository, { withFileTypes: true }); }
  catch { return { value: maximum, truncated: false }; }
  const names = entries.map((entry) => entry.name).filter((name) => !EXCLUDED_RECENCY_NAMES.has(name)).sort();
  const selected = names.slice(0, maximumEntries);
  const times = await boundedMap(selected, concurrency, async (name) => {
    try { return (await lstat(path.join(repository, name))).mtimeMs; }
    catch { return 0; }
  });
  return { value: times.reduce((latest, time) => Math.max(latest, time), maximum), truncated: names.length > maximumEntries };
}

function repositoryId(canonicalPath) {
  return `repo-${createHash('sha256').update(canonicalPath).digest('hex').slice(0, 24)}`;
}

function warningText(error) {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
  return `Repository discovery unavailable${detail}`;
}

export class RepositoryService {
  constructor({
    root,
    execFileFn = execFile,
    clock = () => Date.now(),
    command = process.env.GHQ_BIN || 'ghq',
    timeout = DEFAULT_TIMEOUT,
    cacheTtl = DEFAULT_CACHE_TTL,
    maxCandidates = DEFAULT_MAX_CANDIDATES,
    maxRepositories = DEFAULT_MAX_REPOSITORIES,
    maxRecencyEntries = DEFAULT_MAX_RECENCY_ENTRIES,
    maxDirectories = DEFAULT_MAX_DIRECTORIES,
    maxDepth = DEFAULT_MAX_DEPTH,
    concurrency = DEFAULT_CONCURRENCY,
  } = {}) {
    this.configuredRoot = root;
    this.execFileFn = execFileFn;
    this.clock = clock;
    this.command = command;
    this.timeout = timeout;
    this.cacheTtl = cacheTtl;
    this.maxCandidates = maxCandidates;
    this.maxRepositories = maxRepositories;
    this.maxRecencyEntries = maxRecencyEntries;
    this.maxDirectories = maxDirectories;
    this.maxDepth = maxDepth;
    this.concurrency = Number.isSafeInteger(concurrency) && concurrency > 0 ? concurrency : DEFAULT_CONCURRENCY;
    this.cache = null;
    this.inflight = null;
  }

  async list() {
    const now = this.clock();
    if (this.cache && now - this.cache.createdAt < this.cacheTtl) return this.cache.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.#discover().then((value) => {
      this.cache = { createdAt: this.clock(), value };
      return value;
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async #root() {
    if (this.configuredRoot !== undefined) {
      if (typeof this.configuredRoot !== 'string' || !this.configuredRoot.trim()) throw new Error('ghq root is not configured');
      return realpath(path.resolve(this.configuredRoot));
    }
    const output = await new Promise((resolve, reject) => {
      const callback = (error, stdout) => error ? reject(error) : resolve(String(stdout));
      try {
        this.execFileFn(this.command, ['root'], { timeout: this.timeout, maxBuffer: 64 * 1024 }, callback);
      } catch (error) { reject(error); }
    });
    const root = output.trim();
    if (!root) throw new Error('ghq returned an empty root');
    return realpath(path.resolve(root));
  }

  async #discover() {
    let root;
    try {
      root = await this.#root();
      if (!(await stat(root)).isDirectory()) throw new Error('ghq root is not a directory');
    } catch (error) {
      return { root: null, repositories: [], warning: warningText(error) };
    }

    const warnings = [];
    const repositories = [];
    const visited = new Set([root]);
    let frontier = [root];
    let directoriesProcessed = 0;
    let directoryLimitReached = false;
    let candidateLimitReached = false;
    for (let depth = 0; frontier.length && depth <= this.maxDepth; depth += 1) {
      const flags = await boundedMap(frontier, this.concurrency, isRepository);
      const found = frontier.filter((_, index) => flags[index]);
      const available = Math.max(0, this.maxCandidates - repositories.length);
      repositories.push(...found.slice(0, available));
      const expandable = frontier.filter((_, index) => !flags[index]);
      if (found.length > available || (repositories.length >= this.maxCandidates && expandable.length)) {
        candidateLimitReached = true;
        break;
      }
      // A repository is a leaf even if its worktree contains nested directories.
      if (depth === this.maxDepth || directoryLimitReached) break;
      const paths = await childDirectoryPaths(expandable, this.concurrency);
      const remaining = Math.max(0, this.maxDirectories - directoriesProcessed);
      const selectedPaths = paths.slice(0, remaining);
      directoriesProcessed += selectedPaths.length;
      if (paths.length > remaining) directoryLimitReached = true;
      const resolved = await resolveDirectories(selectedPaths, root, this.concurrency);
      frontier = resolved.filter((directory) => {
        if (visited.has(directory)) return false;
        visited.add(directory);
        return true;
      });
    }
    if (directoryLimitReached) warnings.push(`directory limit reached (${this.maxDirectories})`);
    if (candidateLimitReached) warnings.push(`candidate limit reached (${this.maxCandidates})`);

    const records = await boundedMap(repositories, this.concurrency, async (repository) => {
      const recency = await modifiedAt(repository, this.concurrency, this.maxRecencyEntries);
      return {
        id: repositoryId(repository),
        name: path.basename(repository),
        path: repository,
        modifiedAt: recency.value,
        recencyTruncated: recency.truncated,
      };
    });
    records.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
    if (records.some((record) => record.recencyTruncated)) warnings.push(`recency entry limit reached (${this.maxRecencyEntries})`);
    if (records.length > this.maxRepositories) {
      warnings.push(`repository limit reached (${this.maxRepositories})`);
    }
    const selected = records.slice(0, this.maxRepositories).map((record) => ({
      id: record.id,
      name: record.name,
      path: record.path,
      modifiedAt: record.modifiedAt,
    }));
    return { root, repositories: selected, ...(warnings.length ? { warning: `Repository discovery truncated: ${warnings.join('; ')}` } : {}) };
  }
}
