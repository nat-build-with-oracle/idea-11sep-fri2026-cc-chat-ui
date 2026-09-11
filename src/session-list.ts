import type { NativeSession } from './types'

export type SessionTab = 'agents' | 'terminals' | 'saved'

export const sessionGroups = {
  agents: ['Needs input', 'Working', 'Completed', 'Unknown state'],
  terminals: ['Needs input', 'Working', 'Ready', 'Unknown state'],
  saved: ['Saved conversations'],
} as const

export function sessionGroup(session: NativeSession): string {
  if (session.kind === 'saved') return 'Saved conversations'
  if (session.kind === 'background') {
    if (session.state === 'blocked') return 'Needs input'
    if (session.state === 'working') return 'Working'
    if (['done', 'completed', 'failed', 'stopped'].includes(session.state || '')) return 'Completed'
    return 'Unknown state'
  }
  if (session.status === 'waiting') return 'Needs input'
  if (session.status === 'busy') return 'Working'
  return session.status === 'idle' ? 'Ready' : 'Unknown state'
}

export function sessionsForTab(sessions: NativeSession[], tab: SessionTab, search = ''): NativeSession[] {
  const kind = tab === 'agents' ? 'background' : tab === 'terminals' ? 'interactive' : 'saved'
  const needle = search.trim().toLowerCase()
  return sessions.filter(item => item.kind === kind && `${item.name || ''} ${item.cwd} ${item.id || item.sessionId || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
}
