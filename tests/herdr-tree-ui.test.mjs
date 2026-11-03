import assert from 'node:assert/strict'
import test from 'node:test'
import {
  branchHint, chatForWorkspace, countTones, countsLabel, fleetCounts, focusSpaces, groupIsOpen, hasActivity, isLively, nestSpaces,
  parseTreeState, spaceHasSession, tiers, toneOf, withFull, withGroup, withQuiet,
} from '../src/herdr-tree.ts'

const ws = (id, status = 'idle', extra = {}) => ({ id, label: id, status, branch: null, agents: [], ...extra })
const group = (id, kind, workspaces, reachable = true) => ({ id, label: id, kind, command: `herdr --session ${id}`, reachable, workspaces })

test('herdr statuses map onto the chat list tones', () => {
  assert.deepEqual(['blocked', 'working', 'done', 'idle', 'unknown'].map(toneOf), ['needs', 'working', 'done', 'idle', 'none'])
})

test('counts, activity and the spoken summary put needs input first', () => {
  const counts = countTones([ws('a', 'working'), ws('b', 'blocked'), ws('c', 'working'), ws('d', 'idle')])
  assert.deepEqual(counts, { needs: 1, working: 2, done: 0, idle: 1, none: 0 })
  assert.equal(countsLabel(counts), '1 needs input, 2 working')
  assert.equal(countsLabel(countTones([ws('a')])), 'All quiet')
  assert.equal(hasActivity(countTones([ws('a', 'done')])), true)
  const fleet = fleetCounts([group('x', 'local', [ws('a', 'working')]), group('y', 'machine', [], false)])
  assert.equal(fleet.offline, 1)
  assert.equal(fleet.working, 1)
})

test('linked worktrees nest under the main checkout of the same repo; others stay top level', () => {
  const sp = (id, repoKey, linked) => ws(id, 'idle', { repoKey, linked })
  const nodes = nestSpaces([sp('main', 'r', false), sp('plain', null, false), sp('a', 'r', true), sp('b', 'r', true), sp('orphan', 'z', true)])
  assert.deepEqual(nodes.map(node => [node.workspace.id, node.children.map(kid => kid.id)]), [['main', ['a', 'b']], ['plain', []], ['orphan', []]])
})

test('branch hints skip the default branch and repeats of the space name', () => {
  assert.equal(branchHint(ws('rd-team', 'idle', { branch: 'main' })), null)
  assert.equal(branchHint(ws('wt/athena-oracle', 'idle', { branch: 'wt/athena-oracle' })), null)
  assert.equal(branchHint(ws('gods-eyes-os', 'idle', { branch: 'gods-eyes-os' })), null)
  assert.equal(branchHint(ws('fah-fun-oracle', 'idle', { branch: 'brand/avatar-pigment' })), 'brand/avatar-pigment')
  assert.equal(branchHint(ws('x', 'idle', { branch: null })), null)
})

test('only local groups open a chat, matched by agent session id', () => {
  const sessions = [{ sessionId: 'a' }, { sessionId: 'b' }]
  const workspace = ws('w1', 'idle', { agents: [{ paneId: 'p', agent: 'claude', name: null, sessionId: null }, { paneId: 'q', agent: 'claude', name: null, sessionId: 'b' }] })
  assert.equal(chatForWorkspace({ kind: 'local' }, workspace, sessions), sessions[1])
  assert.equal(chatForWorkspace({ kind: 'machine' }, workspace, sessions), undefined)
  assert.equal(spaceHasSession(workspace, 'b'), true)
  assert.equal(spaceHasSession(workspace, null), false)
})

test('lively groups show and open by default; quiet ones wait behind Show N quiet', () => {
  const current = ws('mine', 'idle', { agents: [{ paneId: 'p', agent: 'claude', name: null, sessionId: 'me' }] })
  const groups = [
    group('busy', 'local', [ws('a', 'working')]),
    group('calm', 'local', [ws('b', 'idle')]),
    group('here', 'local', [current]),
    group('box', 'machine', [ws('c', 'blocked')]),
    group('off', 'machine', [ws('d', 'working')], false),
  ]
  assert.equal(isLively(groups[0]), true)
  assert.equal(isLively(groups[1]), false)
  assert.equal(isLively(groups[2], 'me'), true)
  assert.equal(isLively(groups[4]), false, 'an unreachable group is not lively')
  const state = parseTreeState('')
  const view = tiers(groups, state, 'me')
  assert.deepEqual(view.map(tier => [tier.kind, tier.shown.map(item => item.id), tier.hidden]), [['local', ['busy', 'here'], 1], ['machine', ['box'], 1]])
  const opened = withGroup(state, 'calm', true)
  assert.deepEqual(tiers(groups, opened, 'me')[0].shown.map(item => item.id), ['busy', 'calm', 'here'], 'a group opened by hand stays in view')
  assert.equal(groupIsOpen(opened, groups[1]), true)
  assert.equal(groupIsOpen(withGroup(state, 'busy', false), groups[0]), false, 'a hand-closed lively group stays closed')
  const all = withQuiet(state, 'machine', true)
  assert.deepEqual(tiers(groups, all, 'me')[1].shown.map(item => item.id), ['box', 'off'])
  assert.equal(tiers(groups, all, 'me')[1].hidden, 0)
})

test('tree state parsing keeps only booleans and survives garbage', () => {
  assert.deepEqual(parseTreeState('{"groups":{"a":true,"b":"x","c":false},"full":{"a":true},"quiet":{"local":true}}'), { groups: { a: true, c: false }, full: { a: true }, quiet: { local: true, machine: false } })
  assert.deepEqual(parseTreeState('garbage'), { groups: {}, full: {}, quiet: { local: false, machine: false } })
  assert.deepEqual(parseTreeState('["old","collapsed","list"]'), { groups: {}, full: {}, quiet: { local: false, machine: false } })
  assert.deepEqual(withFull(parseTreeState(''), 'g', true).full, { g: true })
})

test('a busy group shows only what is working, waiting or done, with the main checkout as context', () => {
  const sp = (id, status, repoKey = null, linked = false, agents = []) => ws(id, status, { repoKey, linked, agents })
  const busy = group('white', 'machine', [
    sp('rd-team', 'idle', 'rd', false), sp('neo', 'working', 'rd', true), sp('nexus', 'idle', 'rd', true),
    sp('manager', 'idle', 'mg', false), sp('pulse', 'idle', 'mg', true),
    sp('support', 'blocked'), sp('quiet', 'idle'),
  ])
  const focus = focusSpaces(busy)
  assert.deepEqual(focus.nodes.map(node => [node.workspace.id, node.children.map(kid => kid.id)]), [['rd-team', ['neo']], ['support', []]])
  assert.equal(focus.hidden, 4)
  assert.equal(focusSpaces(busy, null, true).hidden, 0, 'Show more lists every space')
  const calm = group('calm', 'local', [sp('a', 'idle'), sp('b', 'idle')])
  assert.equal(focusSpaces(calm).nodes.length, 2, 'a quiet group opened by hand shows everything')
  const mine = group('mine', 'local', [sp('a', 'working'), sp('b', 'idle', null, false, [{ paneId: 'p', agent: 'claude', name: null, sessionId: 'me' }]), sp('c', 'idle')])
  assert.deepEqual(focusSpaces(mine, 'me').nodes.map(node => node.workspace.id), ['a', 'b'], 'the open chat stays in view')
})
