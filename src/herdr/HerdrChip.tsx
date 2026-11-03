import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { StatusDot } from './StatusDot'
import { cx, type Tone } from './ui'

const base = 'inline-flex min-h-[30px] max-w-full items-center gap-1.5 rounded-full text-[13px] max-[759px]:min-h-9 pointer-coarse:min-h-9'

// A followed session: status, name, and a button to stop following it. `gone` = not running now.
export function FollowChip({ tone, label, title, gone = false, onRemove }: { tone: Tone; label: string; title: string; gone?: boolean; onRemove: () => void }) {
  return <span title={title} className={cx(base, 'bg-[var(--color-raised)] pr-1 pl-2.5', gone ? 'font-medium text-[var(--color-muted)]' : 'font-semibold text-[var(--color-ink)]')}>
    <StatusDot tone={tone} /><span className="min-w-0 truncate">{label}</span>
    <button type="button" aria-label={`Stop following ${label}`} onClick={onRemove}
      className="inline-flex size-[22px] items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] max-[759px]:size-8 pointer-coarse:size-8">
      <Icon name="close" size={12} />
    </button>
  </span>
}

// Outline chips: "Choose sessions" / "Add" (accent) and one-click suggestions (ink).
export function OutlineChip({ accent = false, expanded, title, onClick, children }: { accent?: boolean; expanded?: boolean; title?: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" title={title} aria-expanded={expanded} onClick={onClick}
    className={cx(base, 'border border-[var(--color-rule)] bg-transparent pr-[11px] pl-[9px] hover:bg-[var(--color-hover)]',
      accent ? 'text-[var(--color-accent)] aria-expanded:border-transparent aria-expanded:bg-[var(--color-raised)]' : 'font-medium text-[var(--color-ink)]')}>
    {children}
  </button>
}

export function SuggestChip({ tone, label, onFollow }: { tone: Tone; label: string; onFollow: () => void }) {
  return <OutlineChip title={`Follow ${label}`} onClick={onFollow}>
    <StatusDot tone={tone} /><span className="min-w-0 truncate">{label}</span><Icon name="plus" size={12} className="text-[var(--color-muted)]" />
  </OutlineChip>
}
