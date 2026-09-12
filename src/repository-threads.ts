import type { Chat, NativeSession } from './types'
import type { RepositoryThreadSort } from './repository-preferences'

export type RepositoryThread = { kind: 'chat'; item: Chat } | { kind: 'native'; item: NativeSession }

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const label = (thread: RepositoryThread) => thread.kind === 'chat' ? thread.item.title : thread.item.name || 'Untitled thread'
const identity = (thread: RepositoryThread) => thread.kind === 'chat' ? thread.item.id : thread.item.sessionId || thread.item.id || ''
const changedAt = (thread: RepositoryThread) => thread.kind === 'chat'
  ? Date.parse(thread.item.updatedAt) || Date.parse(thread.item.createdAt) || 0
  : thread.item.updatedAt ?? thread.item.startedAt ?? 0

/** Combines app and native threads so each repository has one honest ordering. */
export function sortRepositoryThreads(chats: readonly Chat[], sessions: readonly NativeSession[], sort: RepositoryThreadSort): RepositoryThread[] {
  const rows: RepositoryThread[] = [
    ...chats.map(item => ({ kind: 'chat' as const, item })),
    ...sessions.map(item => ({ kind: 'native' as const, item })),
  ]
  return rows.sort((a, b) => sort === 'name'
    ? names.compare(label(a), label(b)) || changedAt(b) - changedAt(a) || identity(a).localeCompare(identity(b))
    : changedAt(b) - changedAt(a) || names.compare(label(a), label(b)) || identity(a).localeCompare(identity(b)))
}
