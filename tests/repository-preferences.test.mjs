import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRepositoryPreferences,
  parseRepositoryPreferences,
  serializeRepositoryPreferences,
  setRepositoryFavorite,
  setRepositoryName,
  setRepositoryThreadSort,
} from '../src/repository-preferences.ts'
import { parseHiddenRepositories } from '../src/repository-visibility.ts'

const row = (id, path, modifiedAt) => ({
  id,
  path,
  name: path.split('/').pop() || path,
  modifiedAt,
  projectId: null,
  aliases: [`alias-${id}`],
  chats: [{ id: `chat-${id}` }],
  sessions: [{ sessionId: `session-${id}` }],
})

test('repository preferences round-trip normalized paths and safe display names', () => {
  const parsed = parseRepositoryPreferences(JSON.stringify({
    favorites: ['/Code/one/', '/Code/two', '/Code/one'],
    names: { '/Code/one/': '  Primary  ', '/Code/two': 'Secondary' },
  }))
  assert.deepEqual([...parsed.favorites], ['/Code/one', '/Code/two'])
  assert.deepEqual([...parsed.names], [['/Code/one', 'Primary'], ['/Code/two', 'Secondary']])
  const roundTrip = parseRepositoryPreferences(serializeRepositoryPreferences(parsed))
  assert.deepEqual([...roundTrip.favorites], ['/Code/one', '/Code/two'])
  assert.deepEqual([...roundTrip.names], [['/Code/one', 'Primary'], ['/Code/two', 'Secondary']])
  assert.equal(roundTrip.threadSorts.size, 0)
})

test('each repository keeps its own thread ordering preference', () => {
  const original = parseRepositoryPreferences('{}')
  const named = setRepositoryThreadSort(original, '/Code/black-oracle/', 'name')
  const updated = setRepositoryThreadSort(named, '/Code/neo-oracle', 'updated')
  assert.equal(original.threadSorts.size, 0)
  assert.deepEqual([...named.threadSorts], [['/Code/black-oracle', 'name']])
  assert.deepEqual([...parseRepositoryPreferences(serializeRepositoryPreferences(updated)).threadSorts], [
    ['/Code/black-oracle', 'name'],
    ['/Code/neo-oracle', 'updated'],
  ])
  const invalid = parseRepositoryPreferences('{"threadSorts":{"relative":"name","/bad":"oldest","/good/":"name"}}')
  assert.deepEqual([...invalid.threadSorts], [['/good', 'name']])
})

test('preference setters are immutable and clearing a name restores the folder name', () => {
  const original = { favorites: new Set(['/Code/old']), names: new Map([['/Code/repo', 'Old label']]) }
  const favorited = setRepositoryFavorite(original, '/Code/repo/', true)
  const renamed = setRepositoryName(favorited, '/Code/repo/', '  New label  ')
  const cleared = setRepositoryName(renamed, '/Code/repo', '   ')
  assert.deepEqual([...original.favorites], ['/Code/old'])
  assert.deepEqual([...original.names], [['/Code/repo', 'Old label']])
  assert.notEqual(favorited.favorites, original.favorites)
  assert.notEqual(favorited.names, original.names)
  assert.deepEqual([...renamed.names], [['/Code/repo', 'New label']])
  assert.equal(cleared.names.has('/Code/repo'), false)
  assert.equal(applyRepositoryPreferences([row('new-id', '/Code/repo', 1)], cleared)[0].name, 'repo')
})

test('path-keyed preferences survive repository ID changes without altering row identity data', () => {
  const preferences = parseRepositoryPreferences('{"favorites":["/Code/repo"],"names":{"/Code/repo":"Friendly"}}')
  const aliases = ['discovered-old-id', 'saved-id']
  const chats = [{ id: 'chat' }]
  const sessions = [{ sessionId: 'session' }]
  const current = { ...row('new-discovery-id', '/Code/repo', 10), projectId: 'saved-id', aliases, chats, sessions }
  const [applied] = applyRepositoryPreferences([current], preferences)
  assert.notEqual(applied, current)
  assert.equal(applied.id, 'new-discovery-id')
  assert.equal(applied.path, '/Code/repo')
  assert.equal(applied.name, 'Friendly')
  assert.equal(applied.projectId, 'saved-id')
  assert.equal(applied.aliases, aliases)
  assert.equal(applied.chats, chats)
  assert.equal(applied.sessions, sessions)
})

test('favorites sort first stably while hidden repositories remain a separate preference', () => {
  const rows = [row('newest', '/Code/newest', 30), row('favorite-a', '/Code/a', 20), row('middle', '/Code/middle', 10), row('favorite-b', '/Code/b', 5)]
  const preferences = { favorites: new Set(['/Code/a', '/Code/b']), names: new Map() }
  const applied = applyRepositoryPreferences(rows, preferences)
  assert.deepEqual(applied.map(item => item.id), ['favorite-a', 'favorite-b', 'newest', 'middle'])
  assert.deepEqual(rows.map(item => item.id), ['newest', 'favorite-a', 'middle', 'favorite-b'])
  const hidden = parseHiddenRepositories('["/Code/a"]')
  assert.equal(hidden.has('/Code/a'), true)
  assert.equal(applied.some(item => item.path === '/Code/a'), true)
})

test('corrupt storage, prototype keys, invalid paths, and invalid names are ignored safely', () => {
  for (const raw of ['{broken', 'null', '[]', '"text"']) {
    const parsed = parseRepositoryPreferences(raw)
    assert.equal(parsed.favorites.size, 0)
    assert.equal(parsed.names.size, 0)
  }
  const tooLong = 'x'.repeat(121)
  const parsed = parseRepositoryPreferences(JSON.stringify({
    favorites: ['relative', '/valid/', '/bad\npath', null],
    names: {
      ['__proto__']: 'polluted',
      constructor: 'unsafe',
      prototype: 'unsafe',
      relative: 'Relative',
      '/valid/': ' Valid ',
      '/empty': '   ',
      '/control': 'bad\nname',
      '/long': tooLong,
    },
  }))
  assert.deepEqual([...parsed.favorites], ['/valid'])
  assert.deepEqual([...parsed.names], [['/valid', 'Valid']])
  assert.equal({}.polluted, undefined)

  const invalidPath = setRepositoryFavorite(parsed, 'relative', true)
  const invalidName = setRepositoryName(parsed, '/valid', tooLong)
  const controlName = setRepositoryName(parsed, '/valid', '\n')
  assert.deepEqual([...invalidPath.favorites], ['/valid'])
  assert.deepEqual([...invalidName.names], [['/valid', 'Valid']])
  assert.deepEqual([...controlName.names], [['/valid', 'Valid']])
  const serialized = serializeRepositoryPreferences({
    favorites: new Set(['/valid/', 'relative']),
    names: new Map([['/valid/', ' Good '], ['relative', 'Bad'], ['/bad', 'x\ny']]),
  })
  assert.deepEqual(JSON.parse(serialized), { favorites: ['/valid'], names: { '/valid': 'Good' } })
})
