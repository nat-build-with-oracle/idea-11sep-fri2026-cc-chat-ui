import assert from 'node:assert/strict'
import test from 'node:test'
import { followConversationBottom } from '../src/follow-latest.ts'

test('follow latest scrolls initially, on content growth and viewport resize, and stops after pause', () => {
  const viewport = { scrollTop: 0, scrollHeight: 1200 }
  const content = {}
  const observed = []
  let notify, disconnected = false
  class Observer {
    constructor(callback) { notify = callback }
    observe(element) { observed.push(element) }
    disconnect() { disconnected = true }
  }
  const pause = followConversationBottom(viewport, content, Observer)
  assert.deepEqual(observed, [content, viewport])
  assert.equal(viewport.scrollTop, 1200)
  viewport.scrollTop = 50
  viewport.scrollHeight = 1900
  notify()
  assert.equal(viewport.scrollTop, 1900, 'new output follows even after manual scroll')
  viewport.scrollTop = 1800
  notify()
  assert.equal(viewport.scrollTop, 1900, 'viewport resize keeps bottom visible')
  pause()
  viewport.scrollTop = 100
  viewport.scrollHeight = 2500
  notify()
  assert.equal(viewport.scrollTop, 100, 'queued callbacks cannot scroll after pause/navigation')
  assert.equal(disconnected, true)
  const stop = followConversationBottom(viewport, content, Observer)
  assert.equal(viewport.scrollTop, 2500, 'resuming immediately reaches latest')
  stop()
})
