import { Icon } from './Icon'

export default function HistoryLoadControls({ hasMore, loading, pages, notice, disabled, onMore, onAll, onStop }: {
  hasMore: boolean; loading: 'page' | 'all' | null; pages: number; notice: string; disabled: boolean
  onMore: () => void; onAll: () => void; onStop: () => void
}) {
  if (!hasMore && !loading && !notice) return null
  return <div className="mx-auto mb-7 w-[calc(100%-36px)] max-w-[1000px] space-y-3 text-sm min-[760px]:w-[calc(100%-60px)]" aria-label="Conversation history controls">
    <div className="flex flex-wrap items-center gap-2">
      {hasMore && !loading && <>
        <button type="button" className="primary-button" disabled={disabled} onClick={onAll}><Icon name="download" size={15} />Load all remaining</button>
        <button type="button" className="subtle-button" disabled={disabled} onClick={onMore}>Load more<Icon name="chevron" size={13} /></button>
      </>}
      {loading && <>
        <span role="status" className="flex items-center gap-2 text-[var(--color-muted)]"><Icon name="refresh" size={14} className="motion-safe:animate-spin" />{loading === 'all' ? `Loading history · ${pages} ${pages === 1 ? 'page' : 'pages'} added` : 'Loading history…'}</span>
        <button type="button" className="subtle-button" onClick={onStop}>Stop loading</button>
      </>}
    </div>
    {!loading && notice && <p role="status" className="text-xs leading-relaxed text-[var(--color-muted)]">{notice}</p>}
  </div>
}
