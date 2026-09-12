import assert from 'node:assert/strict'
import test from 'node:test'
import { startNativeSessionRefresh } from '../src/native-session-refresh.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

function createEventTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set()
      current.add(listener)
      listeners.set(type, current)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) listener()
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
  }
}

function createClock() {
  let now = 0
  let nextId = 1
  const timers = new Map()
  return {
    setTimeout(callback, delay) {
      const id = nextId++
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    advance(delay) {
      const end = now + delay
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((left, right) => left[1].at - right[1].at)[0]
        if (!due) break
        const [id, timer] = due
        timers.delete(id)
        now = timer.at
        timer.callback()
      }
      now = end
    },
    get delays() {
      return [...timers.values()].map(timer => timer.at - now)
    },
    get size() {
      return timers.size
    },
  }
}

function harness(refresh) {
  const clock = createClock()
  const documentTarget = Object.assign(createEventTarget(), { visibilityState: 'visible' })
  const windowTarget = createEventTarget()
  const cleanup = startNativeSessionRefresh({ refresh, clock, documentTarget, windowTarget })
  return { cleanup, clock, documentTarget, windowTarget }
}

test('refreshes immediately and polls new native inventory every five seconds', async () => {
  const inventories = []
  let available = ['existing']
  const run = harness(async () => { inventories.push([...available]) })

  assert.deepEqual(inventories, [['existing']])
  await tick()
  available = ['existing', 'new-cli-session']
  run.clock.advance(4_999)
  assert.equal(inventories.length, 1)
  run.clock.advance(1)
  assert.deepEqual(inventories.at(-1), ['existing', 'new-cli-session'])
})

test('focus refreshes immediately and replaces the scheduled poll', async () => {
  let calls = 0
  const run = harness(async () => { calls += 1 })
  await tick()
  assert.deepEqual(run.clock.delays, [5_000])

  run.clock.advance(1_000)
  run.windowTarget.emit('focus')
  assert.equal(calls, 2)
  await tick()
  assert.deepEqual(run.clock.delays, [5_000])
})

test('hidden documents pause polling and visibility return refreshes immediately', async () => {
  let calls = 0
  const run = harness(async () => { calls += 1 })
  await tick()

  run.documentTarget.visibilityState = 'hidden'
  run.documentTarget.emit('visibilitychange')
  assert.equal(run.clock.size, 0)
  run.clock.advance(60_000)
  run.windowTarget.emit('focus')
  assert.equal(calls, 1)

  run.documentTarget.visibilityState = 'visible'
  run.documentTarget.emit('visibilitychange')
  assert.equal(calls, 2)
})

test('failures retry with exponential backoff capped at thirty seconds', async () => {
  let calls = 0
  const run = harness(async () => {
    calls += 1
    if (calls < 4) throw new Error('offline')
  })

  await tick()
  assert.deepEqual(run.clock.delays, [10_000])
  run.clock.advance(10_000)
  await tick()
  assert.deepEqual(run.clock.delays, [20_000])
  run.clock.advance(20_000)
  await tick()
  assert.deepEqual(run.clock.delays, [30_000])
  run.clock.advance(30_000)
  await tick()
  assert.equal(calls, 4)
  assert.deepEqual(run.clock.delays, [5_000])
})

test('concurrent triggers coalesce into one pending refresh without overlap', async () => {
  const requests = []
  let active = 0
  let maxActive = 0
  const run = harness(() => {
    active += 1
    maxActive = Math.max(maxActive, active)
    const request = deferred()
    requests.push(request)
    return request.promise.finally(() => { active -= 1 })
  })

  run.windowTarget.emit('focus')
  run.windowTarget.emit('focus')
  run.documentTarget.emit('visibilitychange')
  assert.equal(requests.length, 1)
  requests[0].resolve()
  await tick()
  assert.equal(requests.length, 2)
  assert.equal(maxActive, 1)
  requests[1].resolve()
  await tick()
  assert.equal(run.clock.size, 1)
})

test('cleanup removes listeners, timers, and stale completion scheduling', async () => {
  const request = deferred()
  let calls = 0
  const run = harness(() => {
    calls += 1
    return request.promise
  })

  assert.equal(run.documentTarget.listenerCount('visibilitychange'), 1)
  assert.equal(run.windowTarget.listenerCount('focus'), 1)
  run.cleanup()
  run.cleanup()
  assert.equal(run.documentTarget.listenerCount('visibilitychange'), 0)
  assert.equal(run.windowTarget.listenerCount('focus'), 0)

  request.resolve()
  await tick()
  run.clock.advance(60_000)
  run.windowTarget.emit('focus')
  run.documentTarget.emit('visibilitychange')
  assert.equal(calls, 1)
  assert.equal(run.clock.size, 0)
})
