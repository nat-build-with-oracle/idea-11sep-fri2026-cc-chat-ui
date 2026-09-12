import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mentionBindings,
  parseMentionBindings,
  resolveMentionBindings,
} from '../src/mention-draft.ts'
import { buildMentionCandidates } from '../src/mentions.ts'

const candidate = (overrides = {}) => ({
  key: 'repository:/code/repo',
  kind: 'repository',
  name: 'Repo',
  path: '/code/repo',
  token: '@repo:repo',
  ...overrides,
})

test('binding parser accepts legacy keys and bounded validated snapshots only', () => {
  const parsed = parseMentionBindings(JSON.stringify([
    'repository:/legacy',
    { key: 'repository:/Users/me/My Project', token: '@repo:my-project' },
    { key: 'session:real-id', token: '@session:alias-realid', path: '/injected', kind: 'oracle' },
    { key: 'bad key', token: '@repo:bad' },
    { key: 'repository:/bad\u0000path', token: '@repo:bad' },
    { key: 'repository:/bad\npath', token: '@repo:bad' },
    { key: 'repository:/bad-token', token: 'not-a-token' },
    'repository:/legacy',
  ]))
  assert.deepEqual(parsed, [
    { key: 'repository:/legacy' },
    { key: 'repository:/Users/me/My Project', token: '@repo:my-project' },
    { key: 'session:real-id', token: '@session:alias-realid' },
  ])
  assert.deepEqual(parseMentionBindings('{broken'), [])
  assert.equal(parseMentionBindings(JSON.stringify(
    Array.from({ length: 40 }, (_, index) => `repository:/repo-${index}`),
  )).length, 32)
})

test('reload after rename resolves latest metadata using the exact persisted token', () => {
  const binding = { key: 'repository:/code/repo', token: '@repo:old-name' }
  const renamed = candidate({ name: 'New name', path: '/latest/execution/path', token: '@repo:new-name' })
  assert.deepEqual(resolveMentionBindings([binding], [renamed], 'ask @repo:old-name'), [
    { ...renamed, token: '@repo:old-name' },
  ])
  assert.deepEqual(resolveMentionBindings([binding], [renamed], 'ask @repo:new-name'), [])
})

test('later token collisions do not invalidate a previously saved token snapshot', () => {
  const initial = buildMentionCandidates({
    projects: [],
    repositories: [{ id: 'one', name: 'app', path: '/one/app', modifiedAt: 1 }],
    chats: [], nativeSessions: [], cwd: '',
  })[0]
  const binding = mentionBindings([initial])[0]
  const afterCollision = buildMentionCandidates({
    projects: [],
    repositories: [
      { id: 'one', name: 'app', path: '/one/app', modifiedAt: 1 },
      { id: 'two', name: 'app', path: '/two/app', modifiedAt: 1 },
    ],
    chats: [], nativeSessions: [], cwd: '',
  }).find(item => item.key === initial.key)
  assert.notEqual(afterCollision.token, initial.token)
  assert.deepEqual(resolveMentionBindings([binding], [afterCollision], `inspect ${initial.token}`), [
    { ...afterCollision, token: initial.token },
  ])
})

test('deleted or partial tokens remove bindings and missing candidates cannot inject metadata', () => {
  const selected = candidate()
  const bindings = mentionBindings([selected])
  assert.deepEqual(resolveMentionBindings(bindings, [selected], 'token deleted'), [])
  assert.deepEqual(resolveMentionBindings(bindings, [selected], `partial ${selected.token}-extra`), [])
  assert.deepEqual(resolveMentionBindings(bindings, [], `present ${selected.token}`), [])
})

test('serialized bindings contain only candidate identity and token snapshot', () => {
  const selected = candidate({
    name: 'Sensitive display',
    path: '/latest/path',
    extra: { arbitrary: true },
  })
  assert.deepEqual(mentionBindings([selected, selected]), [
    { key: 'repository:/code/repo', token: '@repo:repo' },
  ])
})

test('very long native names produce valid distinct persisted token bindings', () => {
  const longName = 'Extremely descriptive native session '.repeat(16)
  const generated = buildMentionCandidates({
    projects: [], repositories: [], chats: [], cwd: '',
    nativeSessions: [
      { id: 'one', sessionId: '12345678-aaaa', name: longName, cwd: '/one' },
      { id: 'two', sessionId: '12345678-bbbb', name: longName, cwd: '/two' },
    ],
  }).filter(item => item.kind === 'session')
  assert.equal(generated.length, 2)
  assert.ok(generated.every(item => item.name.length > 500))
  assert.ok(generated.every(item => item.token.length <= 256))
  assert.equal(new Set(generated.map(item => item.token)).size, 2)

  const bindings = mentionBindings(generated)
  assert.equal(bindings.length, 2)
  assert.deepEqual(parseMentionBindings(JSON.stringify(bindings)), bindings)
  const text = generated.map(item => item.token).join(' ')
  assert.deepEqual(resolveMentionBindings(bindings, generated, text), generated)
})
