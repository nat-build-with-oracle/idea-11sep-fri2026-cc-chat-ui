import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const repositories = [
  {
    id: 'plain',
    name: 'Daily Notes',
    path: '/opt/Code/github.com/example/daily-notes',
    modifiedAt: 30,
    projectId: 'project-plain',
    aliases: ['notes-alias'],
    chats: [{ title: 'secret-message-needle' }],
    sessions: [],
  },
  {
    id: 'black',
    name: 'Black Oracle',
    path: '/opt/Code/github.com/example/black-oracle/',
    modifiedAt: 20,
    projectId: null,
    aliases: ['hidden-alias-needle'],
    chats: [],
    sessions: [],
  },
  {
    id: 'upper',
    name: 'Ampere',
    path: '/opt/Code/github.com/example/AMPERE-ORACLE',
    modifiedAt: 10,
    projectId: null,
    aliases: [],
    chats: [],
    sessions: [{ title: 'hidden-session-needle' }],
  },
  {
    id: 'nested',
    name: 'Client',
    path: '/opt/Code/github.com/example-oracle/client',
    modifiedAt: 5,
    projectId: null,
    aliases: [],
    chats: [],
    sessions: [],
  },
]

async function loadProjectSearch(t) {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  return server.ssrLoadModule('/src/project-search.ts')
}

test('parseProjectSearchScope falls back to all for unsupported values', async t => {
  const { parseProjectSearchScope } = await loadProjectSearch(t)
  assert.equal(parseProjectSearchScope('all'), 'all')
  assert.equal(parseProjectSearchScope('project'), 'project')
  assert.equal(parseProjectSearchScope('oracle'), 'oracle')
  assert.equal(parseProjectSearchScope('messages'), 'all')
})

test('isOracleRepository classifies only final folders ending in -oracle', async t => {
  const { isOracleRepository } = await loadProjectSearch(t)
  assert.equal(isOracleRepository(repositories[1]), true)
  assert.equal(isOracleRepository(repositories[2]), true)
  assert.equal(isOracleRepository(repositories[3]), false)
  assert.equal(isOracleRepository(repositories[0]), false)
})

test('searchRepositories matches repository names and paths case-insensitively', async t => {
  const { searchRepositories } = await loadProjectSearch(t)
  assert.deepEqual(searchRepositories(repositories, ' DAILY ', 'all').map(repo => repo.id), ['plain'])
  assert.deepEqual(searchRepositories(repositories, 'ampere-oracle', 'all').map(repo => repo.id), ['upper'])
})

test('searchRepositories accepts an optional leading @ for Oracle-style lookup', async t => {
  const { searchRepositories } = await loadProjectSearch(t)
  assert.deepEqual(searchRepositories(repositories, '@black', 'all').map(repo => repo.id), ['black'])
})

test('searchRepositories keeps project and Oracle scopes disjoint', async t => {
  const { searchRepositories } = await loadProjectSearch(t)
  assert.deepEqual(searchRepositories(repositories, '', 'project').map(repo => repo.id), ['plain', 'nested'])
  assert.deepEqual(searchRepositories(repositories, '', 'oracle').map(repo => repo.id), ['black', 'upper'])
})

test('searchRepositories preserves repository order', async t => {
  const { searchRepositories } = await loadProjectSearch(t)
  assert.deepEqual(searchRepositories(repositories, '', 'all').map(repo => repo.id), ['plain', 'black', 'upper', 'nested'])
})

test('searchRepositories does not search aliases, chats, or sessions', async t => {
  const { searchRepositories } = await loadProjectSearch(t)
  assert.deepEqual(searchRepositories(repositories, 'hidden-alias-needle', 'all'), [])
  assert.deepEqual(searchRepositories(repositories, 'secret-message-needle', 'all'), [])
  assert.deepEqual(searchRepositories(repositories, 'hidden-session-needle', 'all'), [])
})

test('Cmd+K opens the project and Oracle search modal', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(source, /event\.key\.toLowerCase\(\) === 'k'\)[^{]*\{[^}]*event\.preventDefault\(\);[^}]*openProjectSearch\(\)/s)
  assert.match(source, /function openProjectSearch\(\)[\s\S]*?setModal\('search'\)/)
  assert.match(source, /modal === 'search'[^\n]*<ProjectSearch\b/)
  assert.doesNotMatch(source, /event\.key\.toLowerCase\(\) === 'k'\)[^{]*\{[^}]*focusRepositorySearch\(\)/s)
})
