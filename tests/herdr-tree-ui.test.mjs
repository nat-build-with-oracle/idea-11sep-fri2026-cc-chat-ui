import assert from 'node:assert/strict'
import test from 'node:test'
import { chatForWorkspace, parseCollapsed, reachableCount, statusMark, toggleCollapsed } from '../src/herdr-tree.ts'

const ws = (agents) => ({ id: 'w1', label: 'x', status: 'idle', branch: null, agents })

test('status marks follow herdr: spinner, needs-input, check', () => {
  assert.equal(statusMark('working'), '◐')
  assert.equal(statusMark('blocked'), '!')
  assert.equal(statusMark('idle'), '✓')
  assert.equal(statusMark('done'), '✓')
  assert.equal(statusMark('unknown'), '·')
})

test('only local groups open a chat, matched by agent session id', () => {
  const sessions = [{ sessionId: 'a' }, { sessionId: 'b' }]
  const workspace = ws([{ paneId: 'p', agent: 'claude', name: null, sessionId: null }, { paneId: 'q', agent: 'claude', name: null, sessionId: 'b' }])
  assert.equal(chatForWorkspace({ kind: 'local' }, workspace, sessions), sessions[1])
  assert.equal(chatForWorkspace({ kind: 'machine' }, workspace, sessions), undefined)
  assert.equal(chatForWorkspace({ kind: 'local' }, ws([{ paneId: 'p', agent: null, name: null, sessionId: 'zzz' }]), sessions), undefined)
})

test('reachable counts and collapsed-state persistence helpers', () => {
  assert.deepEqual(reachableCount([{ reachable: true }, { reachable: false }, { reachable: true }]), { reachable: 2, total: 3 })
  assert.deepEqual(toggleCollapsed(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(toggleCollapsed(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(parseCollapsed('["a",3,"b"]'), ['a', 'b'])
  assert.deepEqual(parseCollapsed('garbage'), [])
})
