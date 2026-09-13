import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { RepositoryThreadSort } from './repository-preferences'
import type { NativeSession } from './types'

const actionClass = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-muted)]! hover:bg-[var(--color-hover)]! hover:text-[var(--color-ink)]! [@media(pointer:coarse)]:size-11'

export async function loadFreshExistingTerminal(sessionId: string, loadSessions: () => Promise<{ sessions: NativeSession[] }>) {
  const snapshot = await loadSessions()
  return {
    sessions: snapshot.sessions,
    existingTerminal: snapshot.sessions.find(item => item.sessionId === sessionId)?.existingTerminal,
  }
}

export function RepositoryActions({ name, alias, favorite, threadSort, onFavorite, onRename, onThreadSort, onHide, onSuggestNames }: {
  name: string; alias?: string; favorite: boolean; threadSort: RepositoryThreadSort
  onFavorite: () => void; onRename: (name: string) => void; onThreadSort: (sort: RepositoryThreadSort) => void; onHide: () => void
  onSuggestNames?: () => void
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  function close(restoreFocus = false) { if (details.current) details.current.open = false; setEditing(false); if (restoreFocus) details.current?.querySelector('summary')?.focus() }
  useEffect(() => {
    function outside(event: PointerEvent) { if (event.target instanceof Node && !details.current?.contains(event.target)) close() }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  return <div className="flex shrink-0 items-center">
    <button type="button" className={actionClass} aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${name}`} aria-pressed={favorite} title={favorite ? 'Remove from favorites' : 'Pin to favorites'} onClick={onFavorite}>
      <Icon name="star" size={15} className={favorite ? 'fill-[var(--color-accent)] text-[var(--color-accent)]' : ''} />
    </button>
    <details ref={details} className="relative" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(true) }
    }} onToggle={event => { if (!event.currentTarget.open) setEditing(false) }}>
      <summary className={`${actionClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} aria-label={`Options for ${name}`} title="Repository options"><Icon name="more" size={17} /></summary>
      <div className="absolute top-full right-0 z-20 mt-1 w-60 rounded-xl border border-[var(--color-rule)] bg-[var(--color-panel)] p-2 text-sm text-[var(--color-ink)]">
        {editing ? <form className="space-y-3 p-1" onSubmit={event => { event.preventDefault(); onRename(label); close(true) }}>
          <label className="block text-xs">Display name<input autoFocus className="mt-2 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-canvas)] p-2 text-sm focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" value={label} maxLength={120} onChange={event => setLabel(event.target.value)} /></label>
          <p className="text-xs leading-relaxed text-[var(--color-muted)]">Only the label in this browser changes. Folder and threads stay untouched. Leave blank to reset.</p>
          <div className="flex justify-end gap-2"><button type="button" className="subtle-button" onClick={() => close(true)}>Cancel</button><button className="primary-button">Save</button></div>
        </form> : <>
          <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-[var(--color-muted)]">Sort threads</p>
          {([['updated', 'Latest updated'], ['name', 'Name A–Z']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={threadSort === value} className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--color-hover)]! [@media(pointer:coarse)]:min-h-11 ${threadSort === value ? 'bg-[var(--color-raised)] font-medium text-[var(--color-accent)]' : ''}`} onClick={() => { onThreadSort(value); close(true) }}><span className="flex-1">{label}</span>{threadSort === value && <Icon name="check" size={14} />}</button>)}
          <div className="my-2 border-t border-[var(--color-rule)]" />
          {onSuggestNames && <button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--color-hover)]! [@media(pointer:coarse)]:min-h-11" onClick={() => { close(); onSuggestNames() }}><Icon name="file" size={15} />Suggest session names</button>}
          <button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--color-hover)]! [@media(pointer:coarse)]:min-h-11" onClick={() => { setLabel(alias ?? name); setEditing(true) }}><Icon name="new" size={15} />Rename display name</button>
          <button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--color-hover)]! [@media(pointer:coarse)]:min-h-11" onClick={() => { close(); onHide() }}><Icon name="eyeOff" size={15} />Hide from sidebar</button>
        </>}
      </div>
    </details>
  </div>
}

export function SidebarThread({ title, selected, running, locked, nested, nativeId, existingTerminal, onSelect, onRename, onCopyExistingTerminal, renameDisabled }: {
  title: string; selected: boolean; running?: boolean; locked?: boolean; nested?: boolean; nativeId?: string
  existingTerminal?: NativeSession['existingTerminal']; onSelect: () => void; onRename?: () => void; onCopyExistingTerminal?: () => void; renameDisabled?: boolean
}) {
  return <div className={`group/thread flex min-w-0 items-center ${nested ? 'ml-[30px]' : ''}`}>
    <button type="button" data-native-thread={nativeId} className={`chat-row min-w-0 flex-1 ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={onSelect} title={title}>
      <Icon name="file" size={16} /><span className="truncate">{title}</span>{running && <span className="activity-dot" />}{locked && <Icon name="lock" size={12} />}
    </button>
    {onRename && <button type="button" className={`${actionClass} opacity-0 group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 [@media(hover:none)]:opacity-100`} aria-label={`Rename ${title}`} title={renameDisabled ? 'Rename unavailable while another change is saving' : 'Rename display name'} disabled={renameDisabled} onClick={onRename}><Icon name="new" size={14} /></button>}
    {existingTerminal && onCopyExistingTerminal && <button type="button" className={`${actionClass} existing-terminal-action opacity-0 group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 [@media(hover:none)]:opacity-100`} aria-label={`Copy existing terminal for ${title}`} title={`Copy existing terminal · ${existingTerminal.target}`} onClick={onCopyExistingTerminal}><Icon name="terminal" size={14} /></button>}
  </div>
}
