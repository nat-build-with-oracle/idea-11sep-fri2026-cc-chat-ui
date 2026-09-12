import assert from 'node:assert/strict'
import test from 'node:test'
import { startWorkspaceConnection } from '../src/workspace-connection.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

function harness({ state = Promise.resolve({ projects: [], chats: [] }), health = Promise.resolve({ ok: true }) } = {}) {
  const events = []
  let streamState = () => {}
  let streamConnection = () => {}
  let closed = false
  const calls = { state: 0, health: 0, subscribe: 0 }
  const source = {
    state() { calls.state += 1; return state },
    health() { calls.health += 1; return health },
    subscribe(onState, onConnection) {
      calls.subscribe += 1
      streamState = onState
      streamConnection = onConnection
      return () => { closed = true }
    },
  }
  const cleanup = startWorkspaceConnection({
    onState: value => events.push(['state', value]),
    onHealth: value => events.push(['health', value]),
    onConnection: value => events.push(['connection', value]),
    onIssue: value => events.push(['issue', value.message]),
    onRecovered: () => events.push(['recovered']),
  }, source)
  return {
    calls,
    cleanup,
    events,
    get closed() { return closed },
    streamState: value => streamState(value),
    streamConnection: value => streamConnection(value),
  }
}

test('starts disconnected and a failed REST bootstrap can recover from SSE once', async () => {
  const pending = deferred()
  const run = harness({ state: pending.promise })
  assert.deepEqual(run.events, [['connection', false]])
  assert.deepEqual(run.calls, { state: 1, health: 1, subscribe: 1 })

  pending.reject(new Error('REST unavailable'))
  await tick()
  assert.deepEqual(run.events.at(-1), ['issue', 'REST unavailable'])

  const live = { projects: [{ id: 'live' }], chats: [] }
  run.streamState(live)
  run.streamState({ projects: [{ id: 'newer' }], chats: [] })
  assert.deepEqual(run.events.filter(([type]) => type === 'recovered'), [['recovered']])
  assert.deepEqual(run.events.filter(([type]) => type === 'state').at(-1), ['state', { projects: [{ id: 'newer' }], chats: [] }])
})

test('an SSE snapshot wins over a late REST snapshot and suppresses its late failure', async () => {
  const pending = deferred()
  const run = harness({ state: pending.promise })
  const live = { projects: [{ id: 'sse' }], chats: [] }
  run.streamState(live)
  pending.resolve({ projects: [{ id: 'stale-rest' }], chats: [] })
  await tick()
  assert.deepEqual(run.events.filter(([type]) => type === 'state'), [['state', live]])
  assert.equal(run.events.some(([type]) => type === 'issue'), false)

  const failure = deferred()
  const second = harness({ state: failure.promise })
  second.streamState(live)
  failure.reject(new Error('late REST error'))
  await tick()
  assert.equal(second.events.some(([type]) => type === 'issue'), false)
})

test('cleanup closes the stream and prevents every stale callback', async () => {
  const state = deferred()
  const health = deferred()
  const run = harness({ state: state.promise, health: health.promise })
  run.cleanup()
  assert.equal(run.closed, true)
  const count = run.events.length
  state.resolve({ projects: [{ id: 'late' }], chats: [] })
  health.resolve({ ok: true })
  run.streamConnection(true)
  run.streamState({ projects: [{ id: 'stream-late' }], chats: [] })
  await tick()
  assert.equal(run.events.length, count)
})

test('connection callbacks are edge-triggered and stream failures never become issues', () => {
  const run = harness()
  run.streamConnection(false)
  run.streamConnection(false)
  run.streamConnection(true)
  run.streamConnection(true)
  run.streamConnection(false)
  run.streamConnection(false)
  assert.deepEqual(run.events.filter(([type]) => type === 'connection'), [
    ['connection', false],
    ['connection', true],
    ['connection', false],
  ])
  assert.equal(run.events.some(([type]) => type === 'issue'), false)
})

test('successful REST state recovers once, health failures are ignored, and source is read-only', async () => {
  const snapshot = { projects: [{ id: 'rest' }], chats: [] }
  const run = harness({ state: Promise.resolve(snapshot), health: Promise.reject(new Error('health unavailable')) })
  await tick()
  assert.deepEqual(run.events.filter(([type]) => type === 'state'), [['state', snapshot]])
  assert.deepEqual(run.events.filter(([type]) => type === 'recovered'), [['recovered']])
  assert.equal(run.events.some(([type]) => type === 'issue'), false)
  assert.deepEqual(run.calls, { state: 1, health: 1, subscribe: 1 })
})
