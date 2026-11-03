import assert from 'node:assert/strict'
import test from 'node:test'
import {
  branchHint, chatForWorkspace, countTones, countsLabel, filterTerms, fleetCounts, focusedGroups, focusFromFilter,
  focusSuggestions, groupIsOpen, groupTone, hasActivity, isLively, missingFocus, nestSpaces, parseTreeState,
  pickerGroups, resolveFollow, spaceHasSession, toggleFocus, toneOf, withFocus, withGroup,
} from '../src/herdr-tree.ts'

const ws = (id, status = 'idle', extra = {}) => ({ id, label: id, status, branch: null, agents: [], ...extra })
const group = (id, kind, workspaces, reachable = true, session = id) => ({ id, label: id, kind, session, command: `herdr --session ${id}`, reachable, workspaces })

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
  assert.equal(branchHint(ws('worktree-silver-field-7257', 'idle', { branch: 'worktree/silver-field-7257' })), null)
  assert.equal(branchHint(ws('fah-fun-oracle', 'idle', { branch: 'brand/avatar-pigment' })), 'brand/avatar-pigment')
  assert.equal(branchHint(ws('arraxccdc-team', 'idle', { branch: 'arraxccdc-bodies-to-m6' })), 'arraxccdc-bodies-to-m6')
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

const fleet = [
  group('session:laris-co', 'local', [ws('laris-team', 'working')], true, 'laris-co'),
  group('session:nsm', 'local', [ws('nsm-oracle', 'idle')], true, 'nsm'),
  group('session:neo', 'local', [ws('neo-oracle', 'done')], true, 'neo'),
  group('machine:white-laris-co', 'machine', [ws('athena-oracle', 'blocked')], true, 'laris-co'),
  group('machine:white-nsm', 'machine', [ws('nsm', 'idle')], true, 'nsm'),
  group('machine:gb300', 'machine', [ws('x', 'working')], false, 'default'),
]

test('only the followed sessions show, This Mac first, and a stopped one is reported', () => {
  assert.deepEqual(focusedGroups(fleet, null), [])
  assert.deepEqual(focusedGroups(fleet, ['machine:white-nsm', 'session:nsm']).map(item => item.id), ['session:nsm', 'machine:white-nsm'])
  assert.deepEqual(missingFocus(fleet, ['session:nsm', 'session:gone']), ['session:gone'])
  assert.equal(groupIsOpen(parseTreeState(''), fleet[0]), true)
  assert.equal(groupIsOpen(withGroup(parseTreeState(''), fleet[0].id, false), fleet[0]), false)
})

test('follow and unfollow keep one entry per group', () => {
  let state = parseTreeState('')
  assert.equal(state.focus, null)
  state = toggleFocus(state, 'session:nsm')
  state = toggleFocus(state, 'session:laris-co')
  assert.deepEqual(state.focus, ['session:nsm', 'session:laris-co'])
  state = toggleFocus(state, 'session:nsm')
  assert.deepEqual(state.focus, ['session:laris-co'])
  assert.deepEqual(withFocus(state, ['a', 'a', 'b']).focus, ['a', 'b'])
})

test('a group tone is its most urgent state; suggestions are busy groups not followed yet', () => {
  assert.deepEqual(fleet.map(groupTone), ['working', 'idle', 'done', 'needs', 'idle', 'offline'])
  assert.equal(isLively(fleet[5]), false)
  assert.deepEqual(focusSuggestions(fleet, null).map(item => item.id), ['machine:white-laris-co', 'session:laris-co', 'session:neo'])
  assert.deepEqual(focusSuggestions(fleet, ['session:laris-co'], null, 1).map(item => item.id), ['machine:white-laris-co'])
})

test('the picker finds a session on every machine; an old filter becomes the first choice', () => {
  assert.deepEqual(filterTerms(' Laris-co,  nsm laris-co '), ['laris-co', 'nsm'])
  assert.deepEqual(pickerGroups(fleet, 'laris-co').map(item => item.id), ['session:laris-co', 'machine:white-laris-co'])
  assert.equal(pickerGroups(fleet, '').length, fleet.length)
  assert.deepEqual(focusFromFilter(fleet, 'laris-co nsm'), ['session:laris-co', 'session:nsm', 'machine:white-laris-co', 'machine:white-nsm'])
  assert.deepEqual(focusFromFilter(fleet, '  '), [])
})

test('tree state parsing keeps only valid values and survives garbage', () => {
  assert.deepEqual(parseTreeState('{"groups":{"a":true,"b":"x"},"focus":["s:1","s:1",3,"s:2"],"filter":"nsm"}'), { groups: { a: true }, focus: ['s:1', 's:2'], filter: 'nsm' })
  assert.deepEqual(parseTreeState('garbage'), { groups: {}, focus: null, filter: '' })
  assert.deepEqual(parseTreeState('{"focus":"nope"}').focus, null)
})

test('a default follow list resolves names to groups, local first, and keeps unknown names visible', () => {
  // real groups carry the bare name as label: session:laris-co is 'laris-co', machine:white-nsm is 'white-nsm'
  const both = [...fleet, group('machine:laris-co', 'machine', [], true, 'laris-co')].map(item => ({ ...item, label: item.id.replace(/^(session|machine):/, '') }))
  assert.deepEqual(resolveFollow(both, ['laris-co', 'white-nsm', 'machine:gb300', 'arraxccdc', 'laris-co']),
    ['session:laris-co', 'machine:white-nsm', 'machine:gb300', 'session:arraxccdc'])
})
