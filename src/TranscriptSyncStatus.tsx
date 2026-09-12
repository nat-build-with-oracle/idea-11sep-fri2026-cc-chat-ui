import type { Chat } from './types'

interface TranscriptSyncStatusProps {
  chat: Chat
  syncing: boolean
  connected: boolean
  busy?: boolean
  onSync: () => void
}

export default function TranscriptSyncStatus({ chat, syncing, connected, busy = false, onSync }: TranscriptSyncStatusProps) {
  if (!chat.sessionId) return null

  const running = chat.status === 'running'
  const sync = chat.sync
  const label = !connected ? 'Disconnected' : running ? 'Live response' : syncing || !sync ? 'Checking Claude history' : sync.status === 'synced' ? 'Synced with Claude' : 'Sync needs attention'
  const tone = !connected ? 'text-[var(--color-warning)]' : running || syncing || !sync ? 'text-[var(--color-accent)]' : sync.status === 'synced' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
  const dot = !connected ? 'bg-[var(--color-warning)]' : running || syncing ? 'bg-[var(--color-accent)] motion-safe:animate-pulse' : !sync ? 'bg-[var(--color-disabled-ink)]' : sync.status === 'synced' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'
  const fingerprint = sync?.sourceHash
    ? `Transcript fingerprint: ${sync.sourceHash}. This identifies the Claude history snapshot; it does not prove the rendered conversation matches the JSONL byte-for-byte.`
    : undefined
  const detail = !connected
    ? sync?.status === 'synced' ? 'The last successful snapshot remains available. Reconnect to sync.' : 'Reconnect to check Claude history.'
    : running
    ? 'Claude is responding now.'
    : syncing ? 'Refreshing from the bound Claude session.'
    : sync?.status === 'error' ? sync.error || 'Claude history could not be checked. Try syncing again.'
    : sync?.status === 'synced' && typeof sync.messageCount === 'number' ? `${sync.messageCount.toLocaleString()} messages checked.`
    : !sync ? 'No sync result is available yet.'
    : 'Claude history was checked.'

  return <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-[var(--color-muted)]" aria-label="Claude transcript sync status">
    <span className={`inline-flex min-w-0 items-center gap-2 font-semibold ${tone}`} role="status" title={fingerprint || (sync?.checkedAt ? `Checked ${sync.checkedAt}` : undefined)}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
    <span className="min-w-0 flex-1 wrap-anywhere" title={sync?.status === 'error' ? sync.error : fingerprint}>{detail}</span>
    <button type="button" className="shrink-0 rounded-md border border-[var(--color-rule)] px-2.5 py-1.5 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-raised)] disabled:cursor-default disabled:opacity-60" onClick={onSync} disabled={syncing || busy || running || !connected}>
      {syncing ? 'Syncing…' : 'Sync now'}
    </button>
  </div>
}
