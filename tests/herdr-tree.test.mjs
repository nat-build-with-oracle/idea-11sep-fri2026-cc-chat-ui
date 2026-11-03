import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleGroup, branchForCwd, createHerdrTree, parseMachines, parseTreeAgents, parseWorkspaces, parseWorktreeBranches } from '../server/herdr-tree.mjs'

const ws = (...workspaces) => JSON.stringify({ result: { workspaces } })
const w = (id, label, status, worktree) => ({ workspace_id: id, label, agent_status: status, ...(worktree ? { worktree } : {}) })
const machineList = ['a1\twhite-arraxccdc\tnat@white\tarraxccdc\tenabled', 'b2\toff-box\tx\ty\tdisabled', 'c3\tgb300\tgb300\tdefault\tenabled', 'bad line'].join('\n')

test('parseMachines keeps enabled saved machines only', () => {
  assert.deepEqual(parseMachines(machineList).map(m => m.name), ['white-arraxccdc', 'gb300'])
  assert.deepEqual(parseMachines(null), [])
})

test('parseWorkspaces maps status and returns null for non-lists', () => {
  const out = parseWorkspaces(ws(w('w1', 'team', 'idle', { checkout_path: '/r', repo_key: '/r/.git' }), w('w2', 'x', 'weird'), { label: 'no id' }))
  assert.deepEqual(out.map(x => [x.id, x.label, x.status, x.checkoutPath]), [['w1', 'team', 'idle', '/r'], ['w2', 'x', 'unknown', null]])
  assert.equal(parseWorkspaces('nope'), null)
  assert.equal(parseWorkspaces('{}'), null)
})

test('parseWorktreeBranches maps checkout path to branch', () => {
  const out = JSON.stringify({ result: { worktrees: [{ path: '/r', branch: 'main' }, { path: '/r/wt/a', branch: 'feat/a' }, { path: '/d', is_detached: true }] } })
  assert.deepEqual([...parseWorktreeBranches(out)], [['/r', 'main'], ['/r/wt/a', 'feat/a'], ['/d', 'detached']])
  assert.equal(parseWorktreeBranches('x').size, 0)
})

test('assembleGroup joins workspaces, branches and agent session ids; unreachable has no workspaces', () => {
  const agents = JSON.stringify({ result: { agents: [{ agent: 'claude', agent_session: { kind: 'id', value: 'sid-1' }, name: 'atlas', pane_id: 'w1:p1', workspace_id: 'w1' }, { agent: 'claude', pane_id: 'w2:p1', workspace_id: 'w2' }] } })
  assert.equal(parseTreeAgents(agents).get('w1')[0].sessionId, 'sid-1')
  const group = assembleGroup({ id: 'g', label: 'g', kind: 'local', command: 'herdr' }, ws(w('w1', 'team', 'working', { checkout_path: '/r', repo_key: 'k' }), w('w2', 'plain', 'idle')), agents, new Map([['/r', 'main']]))
  assert.equal(group.reachable, true)
  assert.deepEqual(group.workspaces[0], { id: 'w1', label: 'team', status: 'working', repoKey: 'k', linked: false, checkoutPath: '/r', branch: 'main', agents: [{ paneId: 'w1:p1', agent: 'claude', name: 'atlas', sessionId: 'sid-1' }] })
  assert.equal(group.workspaces[1].branch, null)
  assert.deepEqual(assembleGroup({ id: 'g', label: 'g', kind: 'machine', command: 'c' }, null, null, new Map()).reachable, false)
})

test('snapshot builds local and machine groups, tolerates an unreachable machine, caches', async () => {
  const calls = []
  const run = async (args) => {
    calls.push(args.join(' '))
    const key = args.join(' ')
    if (key === 'session list --json') return JSON.stringify({ sessions: [{ name: 'laris-co', running: true }, { name: 'rd', running: false }] })
    if (key === 'machine list') return machineList
    if (key === '--machine gb300 workspace list' || key === '--machine gb300 agent list') return null
    if (key.endsWith('workspace list')) return ws(w('w1', 'team', 'idle', { checkout_path: '/r', repo_key: 'k' }))
    if (key.endsWith('agent list')) return JSON.stringify({ result: { agents: [] } })
    if (key.includes('worktree list')) return JSON.stringify({ result: { worktrees: [{ path: '/r', branch: 'main' }] } })
    return null
  }
  let time = 0
  const tree = createHerdrTree({ run, ttlMs: 1000, now: () => time })
  const { groups } = await tree.snapshot()
  assert.deepEqual(groups.map(g => [g.label, g.kind, g.reachable]), [['laris-co', 'local', true], ['white-arraxccdc', 'machine', true], ['gb300', 'machine', false]])
  assert.equal(groups[0].workspaces[0].branch, 'main')
  const count = calls.length
  await tree.snapshot()
  assert.equal(calls.length, count)
  time = 5000
  await tree.snapshot()
  assert.ok(calls.length > count)
})

test('snapshot never rejects when herdr is missing', async () => {
  const tree = createHerdrTree({ run: async () => { throw new Error('ENOENT') } })
  assert.deepEqual(await tree.snapshot(), { groups: [] })
})

test('branchForCwd picks the checkout containing the cwd, longest path first', () => {
  const out = JSON.stringify({ result: { worktrees: [{ path: '/r', branch: 'main' }, { path: '/r/wt/a', branch: 'feat/a' }] } })
  assert.equal(branchForCwd(out, '/r'), 'main')
  assert.equal(branchForCwd(out, '/r/wt/a/sub'), 'feat/a')
  assert.equal(branchForCwd(out, '/elsewhere'), null)
  assert.equal(branchForCwd('garbage', '/r'), null)
})

test('spaces without a worktree field get their branch from the pane cwd via worktree list --cwd', async () => {
  const run = async (args) => {
    const key = args.join(' ')
    if (key === 'session list --json') return JSON.stringify({ sessions: [{ name: 's', running: true }] })
    if (key === 'machine list') return ''
    if (key.endsWith('workspace list')) return ws(w('w1', 'plain', 'idle'))
    if (key.endsWith('agent list')) return JSON.stringify({ result: { agents: [{ agent: 'claude', pane_id: 'w1:p1', workspace_id: 'w1', cwd: '/opt/x/plain' }] } })
    if (key.endsWith('worktree list --cwd /opt/x/plain')) return JSON.stringify({ result: { worktrees: [{ path: '/opt/x/plain', branch: 'brand/x' }] } })
    return null
  }
  const { groups } = await createHerdrTree({ run }).snapshot()
  assert.equal(groups[0].workspaces[0].branch, 'brand/x')
  assert.equal('cwd' in groups[0].workspaces[0].agents[0], false)
})

test('workspaces expose repoKey, linked and checkoutPath for nesting', () => {
  const out = ws(w('w1', 'main', 'idle', { checkout_path: '/r', repo_key: 'k', is_linked_worktree: false }), w('w2', 'wt', 'idle', { checkout_path: '/r/wt/a', repo_key: 'k', is_linked_worktree: true }))
  const group = assembleGroup({ id: 'g', label: 'g', kind: 'local', command: 'c' }, out, null, new Map())
  assert.deepEqual(group.workspaces.map(x => [x.repoKey, x.linked, x.checkoutPath]), [['k', false, '/r'], ['k', true, '/r/wt/a']])
})
