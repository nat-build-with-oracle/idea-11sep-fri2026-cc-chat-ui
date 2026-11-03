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
  // "worktree-silver-field-7257" on branch "worktree/silver-field-7257" says the same thing twice.
  const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const label = flat(workspace.label)
  const name = flat(branch)
  const tail = flat(branch.split('/').pop() || branch)
  if (name === label || label.endsWith(tail) || name.endsWith(label)) return null
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
// holds the chat that is open now.
export function isLively(group: HerdrTreeGroup, currentSessionId?: string | null): boolean {
  if (!group.reachable) return false
  return hasActivity(countTones(group.workspaces))
    || (group.kind === 'local' && group.workspaces.some(workspace => spaceHasSession(workspace, currentSessionId)))
}

// `focus` lists the groups the sidebar follows, by id; null until the first choice is made.
// `groups` remembers a followed group folded by hand. `filter` is only read once, to turn a filter
// typed before the picker existed into the first choice.
export interface HerdrTreeState { groups: Record<string, boolean>; focus: string[] | null; filter: string }

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
    const focus = Array.isArray(value?.focus)
      ? [...new Set<string>((value.focus as unknown[]).filter((id): id is string => typeof id === 'string' && id.length <= 200))].slice(0, 60)
      : null
    return { groups: booleans(value?.groups), focus, filter: typeof value?.filter === 'string' ? value.filter.slice(0, 120) : '' }
  } catch { return { groups: {}, focus: null, filter: '' } }
}

// A followed group opens unless it was folded by hand.
export function groupIsOpen(state: HerdrTreeState, group: HerdrTreeGroup): boolean {
  return state.groups[group.id] ?? true
}

export function withGroup(state: HerdrTreeState, id: string, open: boolean): HerdrTreeState {
  return { ...state, groups: { ...state.groups, [id]: open } }
}

export function withFocus(state: HerdrTreeState, focus: string[]): HerdrTreeState {
  return { ...state, focus: [...new Set(focus)].slice(0, 60) }
}

export function toggleFocus(state: HerdrTreeState, id: string): HerdrTreeState {
  const focus = state.focus ?? []
  return withFocus(state, focus.includes(id) ? focus.filter(item => item !== id) : [...focus, id])
}

// The groups the sidebar follows, This Mac first, each kind in herdr's own order.
export function focusedGroups(groups: HerdrTreeGroup[], focus: string[] | null): HerdrTreeGroup[] {
  if (!focus?.length) return []
  const chosen = new Set(focus)
  return (['local', 'machine'] as const).flatMap(kind => groups.filter(group => group.kind === kind && chosen.has(group.id)))
}

// Chosen ids whose session or machine is not in the tree right now (stopped, removed or renamed).
export function missingFocus(groups: HerdrTreeGroup[], focus: string[] | null): string[] {
  const ids = new Set(groups.map(group => group.id))
  return (focus ?? []).filter(id => !ids.has(id))
}

// One tone for a whole group, the most urgent first; an unreachable group is `offline`.
export function groupTone(group: HerdrTreeGroup): HerdrTone | 'offline' {
  if (!group.reachable) return 'offline'
  const counts = countTones(group.workspaces)
  return (['needs', 'working', 'done', 'idle'] as const).find(tone => counts[tone] > 0) ?? 'none'
}

const urgency = { needs: 0, working: 1, done: 2, idle: 3, none: 4, offline: 5 } as const

// One-click suggestions: lively groups not followed yet, most urgent first.
export function focusSuggestions(groups: HerdrTreeGroup[], focus: string[] | null, currentSessionId?: string | null, limit = 6): HerdrTreeGroup[] {
  const chosen = new Set(focus ?? [])
  return groups.filter(group => !chosen.has(group.id) && isLively(group, currentSessionId))
    .map((group, index) => ({ group, index }))
    .sort((a, b) => urgency[groupTone(a.group)] - urgency[groupTone(b.group)] || a.index - b.index)
    .slice(0, limit).map(item => item.group)
}

// "laris-co nsm" or "laris-co, nsm": any term may match. Terms are lower-cased and de-duplicated.
export function filterTerms(raw: string): string[] {
  return [...new Set(raw.toLowerCase().split(/[\s,]+/).map(term => term.trim()).filter(Boolean))].slice(0, 8)
}

// The picker's search: group names and herdr sessions ("laris-co" finds white-laris-co too).
export function pickerGroups(groups: HerdrTreeGroup[], query: string): HerdrTreeGroup[] {
  const terms = filterTerms(query)
  if (!terms.length) return groups
  return groups.filter(group => terms.some(term => group.label.toLowerCase().includes(term) || (group.session ?? '').toLowerCase().includes(term)))
}

// A filter typed before the picker existed becomes the first choice: the groups it named.
export function focusFromFilter(groups: HerdrTreeGroup[], filter: string): string[] {
  return filterTerms(filter).length ? pickerGroups(groups, filter).map(group => group.id) : []
}
