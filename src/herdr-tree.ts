import type { HerdrTreeGroup, HerdrTreeWorkspace, NativeSession } from './types'

// herdr's own marks: spinner while working, ! when it needs input, check when idle/done.
export function statusMark(status: HerdrTreeWorkspace['status']): string {
  if (status === 'working') return '◐'
  if (status === 'blocked') return '×'
  if (status === 'done') return '✓'
  if (status === 'idle') return '○'
  return '·'
}

export interface HerdrTreeRow { workspace: HerdrTreeWorkspace; tee: '' | '├─' | '└─' }

// Linked worktrees nest under the main-checkout space of the same repo, like herdr's sidebar.
export function layoutSpaces(workspaces: HerdrTreeWorkspace[]): HerdrTreeRow[] {
  const parents = new Map<string, HerdrTreeWorkspace>()
  for (const workspace of workspaces) if (workspace.repoKey && !workspace.linked) parents.set(workspace.repoKey, workspace)
  const kids = new Map<string, HerdrTreeWorkspace[]>()
  const top: HerdrTreeWorkspace[] = []
  for (const workspace of workspaces) {
    const parent = workspace.linked && workspace.repoKey ? parents.get(workspace.repoKey) : undefined
    if (parent && parent !== workspace) kids.set(parent.id, [...(kids.get(parent.id) ?? []), workspace])
    else top.push(workspace)
  }
  return top.flatMap(workspace => {
    const list = kids.get(workspace.id) ?? []
    return [{ workspace, tee: '' as const }, ...list.map((kid, index) => ({ workspace: kid, tee: index === list.length - 1 ? '└─' as const : '├─' as const }))]
  })
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

export function reachableCount(groups: HerdrTreeGroup[]): { reachable: number; total: number } {
  return { reachable: groups.filter(group => group.reachable).length, total: groups.length }
}

export function toggleCollapsed(collapsed: string[], id: string): string[] {
  return collapsed.includes(id) ? collapsed.filter(item => item !== id) : [...collapsed, id]
}

export function parseCollapsed(raw: string): string[] {
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 500) : []
  } catch { return [] }
}
