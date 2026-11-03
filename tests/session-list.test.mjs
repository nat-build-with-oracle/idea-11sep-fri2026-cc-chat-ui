import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionGroup, sessionGroups, sessionsForTab } from '../src/session-list.ts'

const row = (id, kind, state, startedAt, status = null) => ({ id, sessionId: id, kind, state, status, startedAt, cwd: '/repo', name: id })

test('Agents includes only backgrounds, newest started first without mutating inventory', () => {
  const inventory = [row('old', 'background', 'blocked', 10), row('saved', 'saved', 'saved', 50), row('terminal', 'interactive', null, 60, 'waiting'), row('new', 'background', 'blocked', 20)]
  assert.deepEqual(sessionsForTab(inventory, 'agents').map(item => item.id), ['new', 'old'])
  assert.equal(inventory[0].id, 'old')
  assert.deepEqual(sessionsForTab(inventory, 'terminals').map(item => item.id), ['terminal'])
  assert.deepEqual(sessionsForTab(inventory, 'saved').map(item => item.id), ['saved'])
})

test('native background state groups keep failed and stopped under Completed', () => {
  assert.deepEqual(sessionGroups.agents, ['Needs input', 'Working', 'Completed', 'Unknown state'])
  assert.equal(sessionGroup(row('blocked', 'background', 'blocked', 1)), 'Needs input')
  assert.equal(sessionGroup(row('working', 'background', 'working', 1)), 'Working')
  for (const state of ['done', 'completed', 'failed', 'stopped']) assert.equal(sessionGroup(row(state, 'background', state, 1)), 'Completed')
  assert.equal(sessionGroup(row('future', 'background', 'future', 1)), 'Unknown state')
})

test('terminal status stays separate and search handles names and absolute project paths', () => {
  assert.equal(sessionGroup(row('a', 'interactive', null, 1, 'waiting')), 'Needs input')
  assert.equal(sessionGroup(row('b', 'interactive', null, 1, 'busy')), 'Working')
  assert.equal(sessionGroup(row('c', 'interactive', null, 1, 'idle')), 'Ready')
  const rows = [row('Maw', 'background', 'done', null), row('Other', 'background', 'done', 20)]
  assert.deepEqual(sessionsForTab(rows, 'agents', 'MAW').map(item => item.id), ['Maw'])
  assert.equal(sessionsForTab(rows, 'agents', '/repo').length, 2)
})

test('herdr session filter composes with tab and search; options only list sessions with chats', async () => {
  const { herdrSessionOptions, effectiveHerdrSession } = await import('../src/session-list.ts')
  const mk = (id, herdrSession, name = id) => ({ ...row(id, 'interactive', null, 1, 'idle'), herdrSession, name })
  const rows = [mk('a', 'laris-co'), mk('b', 'laris-co', 'beta'), mk('c', 'arraxccdc'), mk('d', undefined), row('s', 'saved', 'saved', 1)]
  assert.deepEqual(sessionsForTab(rows, 'terminals', '', 'laris-co').map(item => item.id).sort(), ['a', 'b'])
  assert.deepEqual(sessionsForTab(rows, 'terminals', 'beta', 'laris-co').map(item => item.id), ['b'])
  assert.equal(sessionsForTab(rows, 'terminals').length, 4)
  const options = herdrSessionOptions(rows, 'terminals')
  assert.deepEqual(options, [{ name: 'laris-co', count: 2 }, { name: 'arraxccdc', count: 1 }])
  assert.deepEqual(herdrSessionOptions(rows, 'saved'), [])
  assert.equal(effectiveHerdrSession('arraxccdc', options), 'arraxccdc')
  assert.equal(effectiveHerdrSession('gone', options), '')
})
