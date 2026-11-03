import { Icon } from '../Icon'
import { countsLabel, type HerdrCounts } from '../herdr-tree'
import { cx, toneText, type Tone } from './ui'

// The chat list's status vocabulary: working pulses in the accent, needs input is the warning
// color, done is a success check, idle a quiet ring, no agent a faint dot, offline a dashed ring.
const mark: Record<Exclude<Tone, 'done'>, string> = {
  needs: 'size-2 bg-[var(--color-warning)]',
  working: 'size-2 bg-[var(--color-accent)] animate-[working_1.7s_ease-in-out_infinite]',
  idle: 'size-2 border-[1.5px] border-[var(--color-muted)]',
  none: 'size-1 bg-[var(--color-disabled-ink)] opacity-75',
  offline: 'size-2 border-[1.5px] border-dashed border-[var(--color-muted)]',
}

export function StatusDot({ tone, small = false }: { tone: Tone; small?: boolean }) {
  return <span aria-hidden="true" className={cx('inline-flex shrink-0 items-center justify-center', small ? 'size-2.5' : 'size-3')}>
    {tone === 'done' ? <Icon name="check" size={11} className="text-[var(--color-success)]" /> : <span className={cx('rounded-full', mark[tone])} />}
  </span>
}

// Needs input first: it is the one state that waits on you.
export function StatusPips({ counts }: { counts: HerdrCounts }) {
  const tones = (['needs', 'working', 'done'] as const).filter(tone => counts[tone] > 0)
  if (!tones.length) return null
  const label = countsLabel(counts)
  return <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center gap-2">
    {tones.map(tone => <span key={tone} className={cx('inline-flex items-center gap-[3px] text-xs font-semibold tabular-nums', toneText[tone])}>
      <StatusDot tone={tone} small />{counts[tone]}
    </span>)}
  </span>
}

export function OfflineTag({ children = 'offline', title }: { children?: string; title?: string }) {
  return <span title={title} className="shrink-0 whitespace-nowrap rounded-full bg-[var(--color-raised)] px-[7px] py-px text-[11px] font-semibold text-[var(--color-muted)]">{children}</span>
}

export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return <Icon name="chevron" size={12} className={cx('text-[var(--color-muted)] transition-transform duration-150 ease-[cubic-bezier(.22,1,.36,1)]', open && 'rotate-90', className)} />
}
