import type { HerdrTreeGroup, HerdrTreeWorkspace, NativeSession } from './types'

// herdr's own marks: spinner while working, ! when it needs input, check when idle/done.
export function statusMark(status: HerdrTreeWorkspace['status']): string {
  if (status === 'working') return '◐'
  if (status === 'blocked') return '!'
  if (status === 'idle' || status === 'done') return '✓'
  return '·'
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
