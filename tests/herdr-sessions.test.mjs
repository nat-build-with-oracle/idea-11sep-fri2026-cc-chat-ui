import assert from 'node:assert/strict'
import test from 'node:test'
import { annotateSessions, buildSessionMap, createHerdrSessions, parseAgents, parseRunningSessions } from '../server/herdr-sessions.mjs'

const sessionList = JSON.stringify({ sessions: [
  { name: 'default', running: true }, { name: 'laris-co', running: true },
  { name: 'rd', running: false }, { name: '--bad', running: true }, { name: 'arraxccdc', running: true },
] })
const agentList = (...agents) => JSON.stringify({ result: { agents } })
const claude = (value, extra = {}) => ({ agent: 'claude', agent_session: { kind: 'id', value }, pane_id: 'w1:p1', ...extra })

test('parseRunningSessions keeps only running, well-formed names', () => {
  assert.deepEqual(parseRunningSessions(sessionList), ['default', 'laris-co', 'arraxccdc'])
  assert.deepEqual(parseRunningSessions('not json'), [])
  assert.deepEqual(parseRunningSessions(null), [])
})

test('parseAgents extracts agents that report an id-kind session', () => {
  const output = agentList(claude('abc', { name: 'atlas-book' }), { agent: 'codex', agent_session: { kind: 'id', value: 'x' } }, { agent: 'claude', agent_session: { kind: 'none' } }, { agent: 'claude' }, claude('def', { name: undefined, terminal_title_stripped: 'title' }))
  assert.deepEqual(parseAgents(output), [
    { claudeSessionId: 'abc', paneId: 'w1:p1', agentName: 'atlas-book' },
    { claudeSessionId: 'x', paneId: null, agentName: null },
    { claudeSessionId: 'def', paneId: 'w1:p1', agentName: 'title' },
  ])
  assert.deepEqual(parseAgents('{}'), [])
  assert.deepEqual(parseAgents('garbage'), [])
})

test('buildSessionMap prefers the first session and annotateSessions adds herdr fields', () => {
  const map = buildSessionMap([
    { session: 'laris-co', agents: parseAgents(agentList(claude('s1', { name: 'a' }))) },
    { session: 'arraxccdc', agents: parseAgents(agentList(claude('s1'), claude('s2', { pane_id: 'w2:p3' }))) },
  ])
  const out = annotateSessions([{ id: 's1', sessionId: 's1' }, { id: 's2', sessionId: 's2' }, { id: 'none', sessionId: 'none' }], map)
  assert.equal(out[0].herdrSession, 'laris-co')
  assert.equal(out[0].herdrAgent, 'a')
  assert.equal(out[1].herdrSession, 'arraxccdc')
  assert.equal(out[1].herdrPane, 'w2:p3')
  assert.equal('herdrSession' in out[2], false)
})

test('snapshot queries only running sessions, caches, and survives failures', async () => {
  const calls = []
  let time = 0
  const run = async (args) => {
    calls.push(args.join(' '))
    if (args[0] === 'session') return sessionList
    if (args[1] === 'laris-co') return agentList(claude('s1'))
    return null
  }
  const herdr = createHerdrSessions({ run, ttlMs: 1000, now: () => time })
  const first = await herdr.snapshot()
  assert.deepEqual(first.sessions, ['default', 'laris-co', 'arraxccdc'])
  assert.equal(first.map.get('s1').herdrSession, 'laris-co')
  assert.equal(calls.length, 4)
  await herdr.snapshot()
  assert.equal(calls.length, 4)
  time = 2000
  await herdr.snapshot()
  assert.equal(calls.length, 8)
})

test('snapshot never rejects when herdr is missing', async () => {
  const herdr = createHerdrSessions({ run: async () => { throw new Error('ENOENT') } })
  const result = await herdr.snapshot()
  assert.deepEqual(result.sessions, [])
  assert.equal(result.map.size, 0)
})
