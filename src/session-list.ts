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

export const ALL_HERDR_SESSIONS = ''

export function sessionsForTab(sessions: NativeSession[], tab: SessionTab, search = '', herdrSession = ALL_HERDR_SESSIONS): NativeSession[] {
  const kind = tab === 'agents' ? 'background' : tab === 'terminals' ? 'interactive' : 'saved'
  const needle = search.trim().toLowerCase()
  return sessions.filter(item => item.kind === kind && (!herdrSession || item.herdrSession === herdrSession) && `${item.name || ''} ${item.cwd} ${item.id || item.sessionId || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
}

export interface HerdrSessionOption { name: string; count: number }

// Herdr sessions that actually own a chat in this tab (after search), busiest first.
export function herdrSessionOptions(sessions: NativeSession[], tab: SessionTab, search = ''): HerdrSessionOption[] {
  const counts = new Map<string, number>()
  for (const item of sessionsForTab(sessions, tab, search)) {
    if (item.herdrSession) counts.set(item.herdrSession, (counts.get(item.herdrSession) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

// A remembered choice that no longer has chats falls back to All rather than an empty list.
export function effectiveHerdrSession(choice: string, options: HerdrSessionOption[]): string {
  return options.some(option => option.name === choice) ? choice : ALL_HERDR_SESSIONS
}
