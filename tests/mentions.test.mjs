import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMentionCandidates,
  containsCompleteToken,
  expandMentionContext,
  insertMentionToken,
  matchMentionCandidates,
  mentionKindLabel,
  mentionQueryAtCaret,
} from '../src/mentions.ts'

const repository = (id, name, repositoryPath) => ({ id, name, path: repositoryPath, modifiedAt: 1 })
const project = (id, name, projectPath, canonicalPath) => ({
  id, name, path: projectPath, canonicalPath, createdAt: '2026-09-12T00:00:00.000Z',
})
const chat = (id, title, projectId, sessionId) => ({ id, title, projectId, sessionId })
const session = (id, sessionId, name, cwd, action = 'resume') => ({ id, sessionId, name, cwd, action })

function candidates(overrides = {}) {
  return buildMentionCandidates({
    projects: [], repositories: [], chats: [], nativeSessions: [], cwd: '/workspace', ...overrides,
  })
}

test('repositories dedupe by canonical path without replacing their execution path', () => {
  const result = candidates({
    projects: [project('saved', 'app', '/linked/app', '/real/app')],
    repositories: [
      repository('discovered-link', 'app', '/linked/app'),
      repository('other', 'app', '/other/app'),
    ],
    repositoryNames: { '/real/app': 'app' },
  }).filter(candidate => candidate.kind === 'repository')

  assert.equal(result.length, 3) // canonical app, other app, and cwd
  const linked = result.find(candidate => candidate.key === 'repository:/real/app')
  assert.equal(linked.path, '/linked/app')
  const duplicateBasenames = result.filter(candidate => candidate.name === 'app')
  assert.equal(duplicateBasenames.length, 2)
  assert.equal(new Set(duplicateBasenames.map(candidate => candidate.token)).size, 2)
  assert.ok(duplicateBasenames.every(candidate => candidate.token.startsWith('@repo:app-')))
})

test('native-only cwd repositories use native canonical grouping and preserve the cwd path', () => {
  const result = candidates({
    repositories: [repository('canonical', 'Native repo', '/real/native')],
    nativeSessions: [
      { ...session('native', 'feedface-abcd', 'Native thread', '/linked/native'), canonicalPath: '/real/native' },
      session('only', 'deadbeef-abcd', 'Other thread', '/native-only/repo'),
    ],
    cwd: '',
  }).filter(candidate => candidate.kind === 'repository')
  assert.equal(result.filter(candidate => candidate.key === 'repository:/real/native').length, 1)
  assert.equal(result.find(candidate => candidate.key === 'repository:/real/native').path, '/real/native')
  assert.equal(result.find(candidate => candidate.key === 'repository:/native-only/repo').path, '/native-only/repo')
})

test('oracle folders change presentation kind without changing repository identity or token format', () => {
  const [oracle] = candidates({
    repositories: [repository('oracle', 'Black Oracle', '/code/Black-Oracle')],
    cwd: '',
  })
  assert.equal(oracle.kind, 'oracle')
  assert.equal(oracle.key, 'repository:/code/Black-Oracle')
  assert.equal(oracle.token, '@repo:black-oracle')
  assert.equal(mentionKindLabel(oracle), 'Oracle')
  const expanded = expandMentionContext(`consult ${oracle.token}`, [oracle])
  const metadata = JSON.parse(expanded.split('```json\n')[1].split('\n```')[0])
  assert.equal(metadata[0].kind, 'oracle')
})

test('sessions use actual Claude session IDs, include locked sessions, and prefer saved aliases', () => {
  const actualId = '12345678-abcd-4000-8000-000000000001'
  const lockedId = 'abcdef12-abcd-4000-8000-000000000002'
  const result = candidates({
    projects: [project('project-1', 'Repo', '/saved/repo')],
    chats: [
      chat('app-chat-id', 'My saved alias', 'project-1', actualId),
      chat('not-native', 'Skip me', 'project-1', null),
    ],
    nativeSessions: [
      session('app-wrapper-id', actualId, 'Stale native name', '/native/repo'),
      session('other-wrapper-id', lockedId, 'Active elsewhere', '/locked/repo', 'unavailable'),
    ],
  }).filter(candidate => candidate.kind === 'session')

  assert.deepEqual(result.map(candidate => candidate.sessionId).sort(), [actualId, lockedId].sort())
  const saved = result.find(candidate => candidate.sessionId === actualId)
  assert.equal(saved.key, `session:${actualId}`)
  assert.equal(saved.name, 'My saved alias')
  assert.equal(saved.path, '/native/repo')
  assert.equal(saved.token, '@session:my-saved-alias-12345678')
  assert.equal(result.some(candidate => candidate.key.includes('app-chat-id')), false)
  assert.ok(result.some(candidate => candidate.name === 'Active elsewhere'))
})

test('same aliases and UUID prefixes still receive collision-safe tokens', () => {
  const result = candidates({
    nativeSessions: [
      session('one', '12345678-aaaa-4000-8000-000000000001', 'Same alias', '/one'),
      session('two', '12345678-bbbb-4000-8000-000000000002', 'Same alias', '/two'),
    ],
  }).filter(candidate => candidate.kind === 'session')
  assert.equal(new Set(result.map(candidate => candidate.token)).size, 2)
  assert.ok(result.every(candidate => candidate.token.startsWith('@session:same-alias-12345678-')))
})

test('a bound chat with a deleted named project does not inherit an unrelated cwd', () => {
  const result = candidates({
    chats: [chat('orphan', 'Orphaned project', 'deleted-project', 'aaaaaaaa-abcd')],
    cwd: '/different/current-repo',
  })
  assert.equal(result.some(candidate => candidate.kind === 'session'), false)
})

test('a projectless saved session without native cwd does not inherit a changed backend cwd', () => {
  const result = candidates({
    chats: [chat('projectless', 'Old workspace thread', null, 'bbbbbbbb-abcd')],
    cwd: '/new/backend/cwd',
  })
  assert.equal(result.some(candidate => candidate.kind === 'session'), false)
})

test('query detection requires a whitespace boundary and matching searches name, path, and ID', () => {
  assert.equal(mentionQueryAtCaret('mail person@example.com', 23), null)
  assert.equal(mentionQueryAtCaret('prefix(@rep', 11), null)
  assert.deepEqual(mentionQueryAtCaret('ask @rep', 8), { start: 4, end: 8, fragment: 'rep' })

  const rows = candidates({
    repositories: [repository('repo', 'Alpha Code', '/special/location')],
    nativeSessions: [session('wrapper', 'feedface-abcd', 'Thread', '/elsewhere')],
  })
  assert.equal(matchMentionCandidates(rows, 'special')[0].name, 'Alpha Code')
  assert.equal(matchMentionCandidates(rows, 'feedface')[0].sessionId, 'feedface-abcd')
  assert.equal(matchMentionCandidates(rows, '', 2).length, 2)

  const query = mentionQueryAtCaret('ask @alp now', 8)
  const alpha = rows.find(candidate => candidate.name === 'Alpha Code')
  assert.deepEqual(insertMentionToken('ask @alp now', query, alpha), {
    text: `ask ${alpha.token} now`,
    caret: 4 + alpha.token.length,
  })
})

test('context expansion ignores deleted and substring tokens and dedupes selected keys', () => {
  const [candidate] = candidates({ repositories: [repository('repo', 'Alpha', '/alpha')] })
    .filter(item => item.name === 'Alpha')
  assert.equal(expandMentionContext('token was deleted', [candidate]), 'token was deleted')
  assert.equal(
    expandMentionContext(`not complete ${candidate.token}-extra`, [candidate]),
    `not complete ${candidate.token}-extra`,
  )
  assert.equal(containsCompleteToken(`inspect ${candidate.token}.`, candidate.token), true)
  assert.equal(containsCompleteToken(`${candidate.token}suffix`, candidate.token), false)
  const expanded = expandMentionContext(`inspect ${candidate.token}`, [candidate, candidate])
  const metadata = JSON.parse(expanded.split('```json\n')[1].split('\n```')[0])
  assert.deepEqual(metadata, [candidate])
})

test('unicode and quotes are JSON-safe while original input remains byte-for-byte prefix text', () => {
  const [candidate] = candidates({
    repositories: [repository('repo', 'งาน "พิเศษ"', '/งาน/```quoted```')],
    cwd: '',
  })
  const text = `โปรดอ่าน ${candidate.token}\nKeep "this" exactly.`
  const expanded = expandMentionContext(text, [candidate])
  assert.equal(expanded.startsWith(`${text}\n\nReferenced context (metadata only; not conversation history):`), true)
  const serialized = expanded.split('```json\n')[1].split('\n```')[0]
  assert.equal(serialized.includes('```'), false)
  assert.match(serialized, /\\u0060/)
  const metadata = JSON.parse(serialized)
  assert.deepEqual(metadata, [candidate])
})
