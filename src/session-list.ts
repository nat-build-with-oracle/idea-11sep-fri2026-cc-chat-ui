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
  // A chosen herdr session lists its chats of every kind; the tab only applies to All.
  return sessions.filter(item => (herdrSession ? item.herdrSession === herdrSession : item.kind === kind) && `${item.name || ''} ${item.cwd} ${item.id || item.sessionId || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
}

export interface HerdrSessionOption { name: string; count: number }

// Groups shown when a herdr session is chosen (all kinds together).
export const herdrGroups = ['Needs input', 'Working', 'Ready', 'Completed', 'Unknown state', 'Saved conversations'] as const

// Herdr sessions that own a chat of any kind (after search), busiest first.
export function herdrSessionOptions(sessions: NativeSession[], search = ''): HerdrSessionOption[] {
  const counts = new Map<string, number>()
  const needle = search.trim().toLowerCase()
  for (const item of sessions) {
    if (!`${item.name || ''} ${item.cwd} ${item.id || item.sessionId || ''}`.toLowerCase().includes(needle)) continue
    if (item.herdrSession) counts.set(item.herdrSession, (counts.get(item.herdrSession) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

// A remembered choice that no longer has chats falls back to All rather than an empty list.
export function effectiveHerdrSession(choice: string, options: HerdrSessionOption[]): string {
  return options.some(option => option.name === choice) ? choice : ALL_HERDR_SESSIONS
}

// "laris-co · atlas-book · wDW:p1" — whatever parts herdr reported, in that order.
export function herdrInfoLine(session: Pick<NativeSession, 'herdrSession' | 'herdrAgent' | 'herdrPane'>): string {
  return [session.herdrSession, session.herdrAgent, session.herdrPane].filter(Boolean).join(' · ')
}

// Clicking the badge of the active session returns to All.
export function toggleHerdrChoice(current: string, clicked: string): string {
  return current === clicked ? ALL_HERDR_SESSIONS : clicked
}
