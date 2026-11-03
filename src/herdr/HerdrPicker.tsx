import { useEffect, useRef, useState } from 'react'
import { countTones, pickerGroups } from '../herdr-tree'
import type { HerdrTreeGroup } from '../types'
import { OfflineTag, StatusPips } from './StatusDot'
import { cx, rowHover, touch } from './ui'

interface Props { groups: HerdrTreeGroup[]; focus: string[]; onToggle: (id: string) => void; onClear: () => void; onDone: () => void }

const footButton = cx('min-h-[30px] rounded-lg px-[11px] text-[13px]', touch)

// Inline, not an overlay: the sidebar scrolls, and an overlay inside it would be clipped.
export default function HerdrPicker({ groups, focus, onToggle, onClear, onDone }: Props) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { search.current?.focus() }, [])
  const shown = pickerGroups(groups, query)
  const chosen = new Set(focus)
  return <div role="group" aria-label="Choose herdr sessions to follow"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onDone() } }}
    className="mx-2 mb-3 rounded-xl border border-[var(--color-rule)] bg-[var(--color-panel)] p-2.5">
    <input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a session or machine…"
      aria-label="Find a herdr session or machine" spellCheck={false} autoCapitalize="off" autoComplete="off"
      className="mb-1 block w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-canvas)] px-[11px] py-[9px] text-[13px] focus:border-[var(--color-accent)] max-[759px]:text-base" />
    <div className="-mx-1 max-h-[min(46vh,420px)] overflow-y-auto overscroll-contain px-1">
      {(['local', 'machine'] as const).map(kind => {
        const items = shown.filter(group => group.kind === kind)
        if (!items.length) return null
        return <div key={kind}>
          <h3 className="mt-1.5 mb-0.5 px-2 text-xs font-medium text-[var(--color-muted)]">{kind === 'local' ? 'This Mac' : 'Machines'}</h3>
          {items.map(group => <label key={group.id} title={group.command}
            className={cx('flex min-h-[34px] cursor-pointer items-center gap-[9px] rounded-[7px] px-1.5 text-sm', touch, rowHover)}>
            <input type="checkbox" checked={chosen.has(group.id)} onChange={() => onToggle(group.id)} className="m-0 size-4 shrink-0 accent-[var(--color-accent)]" />
            <span className="min-w-0 flex-1 truncate">{group.label}</span>
            {group.reachable ? <StatusPips counts={countTones(group.workspaces)} /> : <OfflineTag />}
            <span className="shrink-0 text-xs font-medium tabular-nums text-[var(--color-muted)]">{group.workspaces.length}</span>
          </label>)}
        </div>
      })}
      {!shown.length && <p className="sidebar-empty">No session or machine matches “{query.trim()}”.</p>}
    </div>
    <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--color-rule)] pt-2 text-xs text-[var(--color-muted)]">
      <span className="mr-auto">{focus.length ? `${focus.length} followed` : 'None followed'}</span>
      {focus.length > 0 && <button type="button" onClick={onClear} className={cx(footButton, 'text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]')}>Clear</button>}
      <button type="button" onClick={onDone} className={cx(footButton, 'bg-[var(--color-accent)] font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]')}>Done</button>
    </div>
  </div>
}
