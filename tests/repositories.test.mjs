import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RepositoryService } from '../server/repositories.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-repositories-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function repository(root, relative, { gitFile = false } = {}) {
  const target = path.join(root, relative);
  await mkdir(target, { recursive: true });
  if (gitFile) await writeFile(path.join(target, '.git'), 'gitdir: /tmp/example\n');
  else await mkdir(path.join(target, '.git'));
  return target;
}

test('discovers conventional and variable-depth ghq repositories and supports worktree git files', async (t) => {
  const root = await fixture(t);
  const first = await repository(root, 'github.com/acme/alpha');
  const worktree = await repository(root, 'gitlab.com/acme/worktree', { gitFile: true });
  const short = await repository(root, 'local/short');
  const nested = await repository(root, 'nested/group/team/deep');
  await mkdir(path.join(root, 'github.com/acme/not-a-repo'), { recursive: true });
  await repository(root, 'node_modules/ignored/repo');
  await repository(root, 'github.com/acme/alpha/nested/repo');

  const result = await new RepositoryService({ root }).list();
  const canonicalFirst = await realpath(first);
  const canonicalWorktree = await realpath(worktree);
  const canonicalShort = await realpath(short);
  const canonicalNested = await realpath(nested);
  assert.equal(result.root, await realpath(root));
  assert.deepEqual(result.repositories.map((item) => item.path).sort(), [canonicalFirst, canonicalWorktree, canonicalShort, canonicalNested].sort());
  assert.equal(result.repositories.find((item) => item.path === canonicalWorktree).name, 'worktree');
  assert.match(result.repositories[0].id, /^repo-[a-f0-9]{24}$/);
});

test('canonical paths are deduplicated, stable IDs follow them, and outside symlinks are rejected', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  const canonical = await repository(root, 'github.com/acme/source');
  await mkdir(path.join(root, 'mirror.test/acme'), { recursive: true });
  await symlink(canonical, path.join(root, 'mirror.test/acme/alias'));
  const escaped = await repository(outside, 'repo');
  await symlink(escaped, path.join(root, 'mirror.test/acme/outside'));

  const first = await new RepositoryService({ root }).list();
  const second = await new RepositoryService({ root }).list();
  assert.equal(first.repositories.length, 1);
  assert.equal(first.repositories[0].path, await realpath(canonical));
  assert.equal(first.repositories[0].id, second.repositories[0].id);
});

test('sorts by shallow filesystem recency and excludes generated top-level trees', async (t) => {
  const root = await fixture(t);
  const older = await repository(root, 'github.com/acme/older');
  const newer = await repository(root, 'github.com/acme/newer');
  await writeFile(path.join(older, 'README.md'), 'old');
  await writeFile(path.join(newer, 'package.json'), '{}');
  await mkdir(path.join(older, 'node_modules/pkg'), { recursive: true });
  const base = new Date('2026-01-01T00:00:00Z');
  const recent = new Date('2026-01-03T00:00:00Z');
  const ignored = new Date('2026-01-04T00:00:00Z');
  await utimes(older, base, base);
  await utimes(newer, base, base);
  await utimes(path.join(older, 'README.md'), base, base);
  await utimes(path.join(newer, 'package.json'), recent, recent);
  await utimes(path.join(older, 'node_modules'), ignored, ignored);

  const result = await new RepositoryService({ root }).list();
  assert.deepEqual(result.repositories.map((item) => item.name), ['newer', 'older']);
  assert.equal(result.repositories[0].modifiedAt, recent.getTime());
  assert.equal(result.repositories[1].modifiedAt, base.getTime());
});

test('candidate and directory budgets stop traversal deterministically and report truncation', async (t) => {
  const root = await fixture(t);
  await repository(root, 'a.example/owner/one');
  await repository(root, 'a.example/owner/two');
  await repository(root, 'b.example/owner/three');
  const candidates = await new RepositoryService({ root, maxCandidates: 1 }).list();
  assert.equal(candidates.repositories.length, 1);
  assert.equal(candidates.repositories[0].name, 'one');
  assert.match(candidates.warning, /candidate limit reached/);
  const directories = await new RepositoryService({ root, maxDirectories: 1 }).list();
  assert.equal(directories.repositories.length, 0);
  assert.match(directories.warning, /directory limit reached/);
});

test('repository limit keeps the most recently modified candidate rather than the alphabetically first', async (t) => {
  const root = await fixture(t);
  const alphabeticallyFirst = await repository(root, 'github.com/acme/alpha');
  const newest = await repository(root, 'github.com/acme/zulu');
  const oldTime = new Date('2026-01-01T00:00:00Z');
  const newTime = new Date('2026-01-05T00:00:00Z');
  await utimes(alphabeticallyFirst, oldTime, oldTime);
  await utimes(newest, newTime, newTime);

  const result = await new RepositoryService({ root, maxRepositories: 1 }).list();
  assert.deepEqual(result.repositories.map((item) => item.name), ['zulu']);
  assert.match(result.warning, /repository limit reached/);
});

test('recency metadata work is capped and warns without leaking internal fields', async (t) => {
  const root = await fixture(t);
  const target = await repository(root, 'github.com/acme/many-files');
  await writeFile(path.join(target, 'a'), 'a');
  await writeFile(path.join(target, 'b'), 'b');
  const result = await new RepositoryService({ root, maxRecencyEntries: 1 }).list();
  assert.match(result.warning, /recency entry limit reached/);
  assert.equal('recencyTruncated' in result.repositories[0], false);
});

test('missing roots and unavailable ghq return an empty warning result', async (t) => {
  const root = await fixture(t);
  assert.deepEqual((await new RepositoryService({ root: path.join(root, 'missing') }).list()).repositories, []);
  let invocation;
  const unavailable = new RepositoryService({ execFileFn(command, args, options, callback) {
    invocation = { command, args, options };
    callback(new Error('not installed'));
  } });
  const result = await unavailable.list();
  assert.equal(result.root, null);
  assert.deepEqual(result.repositories, []);
  assert.match(result.warning, /not installed/);
  assert.deepEqual(invocation.args, ['root']);
  assert.equal(invocation.options.timeout, 2000);
  assert.equal('shell' in invocation.options, false);
});

test('cache expiry and concurrent calls use one bounded ghq discovery', async (t) => {
  const root = await fixture(t);
  await repository(root, 'github.com/acme/one');
  let now = 100;
  let calls = 0;
  const service = new RepositoryService({
    clock: () => now,
    cacheTtl: 60,
    execFileFn(command, args, options, callback) {
      calls += 1;
      setTimeout(() => callback(null, `${root}\n`), 5);
    },
  });
  const [first, concurrent] = await Promise.all([service.list(), service.list()]);
  assert.strictEqual(first, concurrent);
  assert.equal(calls, 1);
  assert.strictEqual(await service.list(), first);
  assert.equal(calls, 1);
  now = 161;
  await service.list();
  assert.equal(calls, 2);
});
