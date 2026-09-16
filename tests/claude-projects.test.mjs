import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discoverClaudeProjects } from '../server/claude-projects.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-projects-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

const transcript = (cwd, extra = {}) =>
  `${JSON.stringify({ type: 'summary' })}\n${JSON.stringify({ cwd, ...extra })}\n`

test('the cwd comes from the transcript, never from the lossy directory name', async t => {
  const root = await fixture(t)
  // Claude turns '/', '.' and non-ASCII all into '-', so this name is unparseable.
  // The real path below contains a 'ψ' and a '.', neither recoverable from the name.
  const real = await mkdtemp(path.join(tmpdir(), 'real-'))
  t.after(() => rm(real, { recursive: true, force: true }))
  const dir = path.join(root, '-tmp-real-github-com-acme---lab-ui')
  await mkdir(dir)
  await writeFile(path.join(dir, 'a.jsonl'), transcript(real))

  const { projects } = await discoverClaudeProjects({ root })
  assert.equal(projects.length, 1)
  assert.equal(projects[0].path, real)
})

test('a project directory with no transcript is skipped rather than guessed at', async t => {
  const root = await fixture(t)
  await mkdir(path.join(root, '-opt-Code-acme-thing'))
  // A subdirectory is not a transcript: this is the shape left behind when a shell
  // merely cd'd somewhere during a session.
  await mkdir(path.join(root, '-opt-Code-acme-thing', 'ff4ab868'), { recursive: true })

  const { projects } = await discoverClaudeProjects({ root })
  assert.deepEqual(projects, [])
})

test('two encoded directories resolving to one cwd merge instead of overwriting', async t => {
  const real = await mkdtemp(path.join(tmpdir(), 'real-'))
  t.after(() => rm(real, { recursive: true, force: true }))
  const root = await fixture(t)
  for (const [name, count] of [['-a-b', 2], ['-a-b-renamed', 3]]) {
    const dir = path.join(root, name)
    await mkdir(dir)
    for (let i = 0; i < count; i += 1) await writeFile(path.join(dir, `${i}.jsonl`), transcript(real))
  }

  const { projects } = await discoverClaudeProjects({ root })
  assert.equal(projects.length, 1)
  assert.equal(projects[0].sessions, 5)
})

test('a missing history directory is a normal state, not a throw', async () => {
  assert.deepEqual(await discoverClaudeProjects({ root: '/nonexistent-claude-projects' }), { root: null, projects: [] })
})

test('a vanished project is omitted by default and included on request', async t => {
  const root = await fixture(t)
  const gone = path.join(tmpdir(), 'deleted-project-xyz')
  const dir = path.join(root, '-tmp-deleted-project-xyz')
  await mkdir(dir)
  await writeFile(path.join(dir, 'a.jsonl'), transcript(gone))

  assert.deepEqual((await discoverClaudeProjects({ root })).projects, [])

  const kept = (await discoverClaudeProjects({ root, includeMissing: true })).projects
  assert.equal(kept.length, 1)
  assert.equal(kept[0].missing, true)
})

test('a line truncated by the read window is dropped rather than misparsed', async t => {
  const real = await mkdtemp(path.join(tmpdir(), 'real-'))
  t.after(() => rm(real, { recursive: true, force: true }))
  const root = await fixture(t)
  const dir = path.join(root, '-a')
  await mkdir(dir)
  // A valid record, then padding that pushes a second record past the read window.
  const padding = `${JSON.stringify({ note: 'x'.repeat(4000) })}\n`
  await writeFile(path.join(dir, 'a.jsonl'), transcript(real) + padding.repeat(4))

  const { projects } = await discoverClaudeProjects({ root, maxHeadBytes: 4096 })
  assert.equal(projects.length, 1)
  assert.equal(projects[0].path, real)
})

test('newest activity wins the ordering', async t => {
  const root = await fixture(t)
  const older = await mkdtemp(path.join(tmpdir(), 'older-'))
  const newer = await mkdtemp(path.join(tmpdir(), 'newer-'))
  t.after(() => Promise.all([rm(older, { recursive: true, force: true }), rm(newer, { recursive: true, force: true })]))
  for (const [name, cwd] of [['-old', older], ['-new', newer]]) {
    const dir = path.join(root, name)
    await mkdir(dir)
    await writeFile(path.join(dir, 'a.jsonl'), transcript(cwd))
    if (name === '-old') await new Promise(resolve => setTimeout(resolve, 12))
  }

  const { projects } = await discoverClaudeProjects({ root })
  assert.equal(projects.length, 2)
  assert.equal(projects[0].path, newer)
})
