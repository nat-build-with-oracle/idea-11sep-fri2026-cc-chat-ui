import { Icon } from '../Icon'
import { branchHint, toneLabel, toneOf } from '../herdr-tree'
import type { HerdrTreeGroup, HerdrTreeWorkspace, NativeSession } from '../types'
import { StatusDot } from './StatusDot'
import { cx, rowHover, touch } from './ui'

interface Props {
  group: HerdrTreeGroup
  workspace: HerdrTreeWorkspace
  child?: boolean
  current: boolean
  chat?: NativeSession
  onOpen: (item: NativeSession) => void
  onCopy: (text: string, label: string) => void
}

// One herdr space: status, name, a branch only when it says something, and what a click does.
export default function HerdrSpace({ group, workspace, child = false, current, chat, onOpen, onCopy }: Props) {
  const tone = toneOf(workspace.status)
  const hint = branchHint(workspace)
  const pane = workspace.agents[0]?.paneId
  const command = `${group.command} pane list --workspace ${workspace.id}`
  const action = chat ? 'Open chat' : 'Copy herdr command'
  const title = [workspace.label, workspace.branch && `branch ${workspace.branch}`, toneLabel[tone], `${workspace.id}${pane ? ` · ${pane}` : ''}`, action].filter(Boolean).join(' · ')
  return <button type="button" title={title} aria-current={current ? 'true' : undefined}
    aria-label={`${workspace.label}, ${toneLabel[tone]}${workspace.branch ? `, branch ${workspace.branch}` : ''}. ${action}`}
    onClick={() => chat ? onOpen(chat) : onCopy(command, 'herdr command copied')}
    className={cx('group flex min-h-8 w-full items-center gap-[9px] rounded-[7px] pr-2 text-left', touch, rowHover,
      child ? 'pl-3.5 text-[13px]' : 'pl-7 text-sm',
      current ? 'bg-[var(--color-raised)] font-semibold text-[var(--color-accent)]' : child ? 'text-[var(--color-muted)] hover:text-[var(--color-ink)]' : 'text-[var(--color-ink)]')}>
    <StatusDot tone={tone} />
    <span className="min-w-0 flex-1 truncate">{workspace.label}</span>
    {hint && <code className="max-w-[48%] shrink truncate font-mono text-[.87em] font-normal text-[var(--color-muted)]">{hint}</code>}
    <Icon name={chat ? 'chevron' : 'copy'} size={13}
      className="text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-[759px]:opacity-100 pointer-coarse:opacity-100" />
  </button>
}
