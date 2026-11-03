import type { HerdrTreeGroup, HerdrTreeWorkspace, NativeSession } from './types'

// One status language for herdr and the chat list: working pulses in the accent, needs input is the
// warning color, done is success, idle is a quiet ring, and a space with no agent is a faint dot.
export type HerdrTone = 'needs' | 'working' | 'done' | 'idle' | 'none'

export const toneLabel: Record<HerdrTone, string> = {
  needs: 'Needs input', working: 'Working', done: 'Done', idle: 'Idle', none: 'No agent',
}

export function toneOf(status: HerdrTreeWorkspace['status']): HerdrTone {
  if (status === 'blocked') return 'needs'
  if (status === 'working') return 'working'
  if (status === 'done') return 'done'
  if (status === 'idle') return 'idle'
  return 'none'
}

export type HerdrCounts = Record<HerdrTone, number>

export function countTones(workspaces: HerdrTreeWorkspace[]): HerdrCounts {
  const counts: HerdrCounts = { needs: 0, working: 0, done: 0, idle: 0, none: 0 }
  for (const workspace of workspaces) counts[toneOf(workspace.status)] += 1
  return counts
}

// Totals for the section head; `offline` counts groups that did not answer.
export function fleetCounts(groups: HerdrTreeGroup[]): HerdrCounts & { offline: number } {
  const total = countTones(groups.flatMap(group => group.workspaces))
  return { ...total, offline: groups.filter(group => !group.reachable).length }
}

export function hasActivity(counts: HerdrCounts): boolean {
  return counts.needs + counts.working + counts.done > 0
}

export function countsLabel(counts: HerdrCounts): string {
  const parts = (['needs', 'working', 'done'] as const).filter(tone => counts[tone] > 0)
    .map(tone => `${counts[tone]} ${toneLabel[tone].toLowerCase()}`)
  return parts.length ? parts.join(', ') : 'All quiet'
}

export interface HerdrNode { workspace: HerdrTreeWorkspace; children: HerdrTreeWorkspace[] }

// Linked worktrees nest under the main-checkout space of the same repo, like herdr's own sidebar.
export function nestSpaces(workspaces: HerdrTreeWorkspace[]): HerdrNode[] {
  const parents = new Map<string, HerdrTreeWorkspace>()
  for (const workspace of workspaces) if (workspace.repoKey && !workspace.linked) parents.set(workspace.repoKey, workspace)
  const nodes: HerdrNode[] = []
  const byParent = new Map<string, HerdrNode>()
  const pending: HerdrTreeWorkspace[] = []
  for (const workspace of workspaces) {
    const parent = workspace.linked && workspace.repoKey ? parents.get(workspace.repoKey) : undefined
    if (parent && parent !== workspace) { pending.push(workspace); continue }
    const node = { workspace, children: [] }
    nodes.push(node)
    byParent.set(workspace.id, node)
  }
  for (const workspace of pending) byParent.get(parents.get(workspace.repoKey!)!.id)?.children.push(workspace)
  return nodes
}

// A branch worth printing: not the default branch, and not a repeat of the space's own name.
export function branchHint(workspace: HerdrTreeWorkspace): string | null {
  const branch = workspace.branch?.trim()
  if (!branch || branch === 'main' || branch === 'master') return null
  const label = workspace.label.trim()
  if (branch === label || label.endsWith(`/${branch}`) || branch.endsWith(`/${label}`)) return null
  return branch
}

export function spaceHasSession(workspace: HerdrTreeWorkspace, sessionId?: string | null): boolean {
  return Boolean(sessionId) && workspace.agents.some(agent => agent.sessionId === sessionId)
}

// Only a local group can match a chat on this Mac; remote transcripts live elsewhere.
export function chatForWorkspace(group: HerdrTreeGroup, workspace: HerdrTreeWorkspace, sessions: NativeSession[]): NativeSession | undefined {
  if (group.kind !== 'local') return undefined
  for (const agent of workspace.agents) {
    if (!agent.sessionId) continue
    const found = sessions.find(item => item.sessionId === agent.sessionId)
    if (found) return found
  }
  return undefined
}

// A group is lively when something in it is working, needs input or just finished, or when it
// holds the chat that is open now. Lively groups show and open by default; quiet ones wait behind
// "Show N quiet …" until asked for.
export function isLively(group: HerdrTreeGroup, currentSessionId?: string | null): boolean {
  if (!group.reachable) return false
  return hasActivity(countTones(group.workspaces))
    || (group.kind === 'local' && group.workspaces.some(workspace => spaceHasSession(workspace, currentSessionId)))
}

export interface HerdrTreeState { groups: Record<string, boolean>; full: Record<string, boolean>; quiet: { local: boolean; machine: boolean } }

export const emptyTreeState: HerdrTreeState = { groups: {}, full: {}, quiet: { local: false, machine: false } }

function booleans(value: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [id, flag] of Object.entries(value).slice(0, 500)) if (typeof flag === 'boolean') out[id] = flag
  }
  return out
}

export function parseTreeState(raw: string): HerdrTreeState {
  try {
    const value = JSON.parse(raw)
    return { groups: booleans(value?.groups), full: booleans(value?.full), quiet: { local: value?.quiet?.local === true, machine: value?.quiet?.machine === true } }
  } catch { return { groups: {}, full: {}, quiet: { local: false, machine: false } } }
}

export function groupIsOpen(state: HerdrTreeState, group: HerdrTreeGroup, currentSessionId?: string | null): boolean {
  return state.groups[group.id] ?? isLively(group, currentSessionId)
}

export function withGroup(state: HerdrTreeState, id: string, open: boolean): HerdrTreeState {
  return { ...state, groups: { ...state.groups, [id]: open } }
}

export function withFull(state: HerdrTreeState, id: string, full: boolean): HerdrTreeState {
  return { ...state, full: { ...state.full, [id]: full } }
}

export function withQuiet(state: HerdrTreeState, kind: HerdrTreeGroup['kind'], show: boolean): HerdrTreeState {
  return { ...state, quiet: { ...state.quiet, [kind]: show } }
}

export interface HerdrTier { kind: HerdrTreeGroup['kind']; shown: HerdrTreeGroup[]; hidden: number; quiet: number }

// This Mac first, then saved machines, each in herdr's own order (no reshuffling on every poll).
// A group the user opened by hand stays in view even when it goes quiet.
export function tiers(groups: HerdrTreeGroup[], state: HerdrTreeState, currentSessionId?: string | null): HerdrTier[] {
  return (['local', 'machine'] as const).map(kind => {
    const all = groups.filter(group => group.kind === kind)
    const keep = (group: HerdrTreeGroup) => isLively(group, currentSessionId) || state.groups[group.id] === true
    const quiet = all.filter(group => !keep(group)).length
    const shown = state.quiet[kind] ? all : all.filter(keep)
    return { kind, shown, hidden: all.length - shown.length, quiet }
  }).filter(tier => tier.shown.length + tier.hidden > 0)
}

// Inside a busy group, show what is working, waiting or done (and the chat open now), with the
// main checkout kept as context for a busy worktree. The rest is `hidden` behind "Show N more".
export function focusSpaces(group: HerdrTreeGroup, currentSessionId?: string | null, full = false): { nodes: HerdrNode[]; hidden: number } {
  const nodes = nestSpaces(group.workspaces)
  if (full || !hasActivity(countTones(group.workspaces))) return { nodes, hidden: 0 }
  const relevant = (workspace: HerdrTreeWorkspace) => hasActivity(countTones([workspace])) || spaceHasSession(workspace, currentSessionId)
  const shown = nodes.map(node => ({ workspace: node.workspace, children: node.children.filter(relevant) }))
    .filter(node => relevant(node.workspace) || node.children.length > 0)
  const count = shown.reduce((sum, node) => sum + 1 + node.children.length, 0)
  return { nodes: shown, hidden: group.workspaces.length - count }
}
