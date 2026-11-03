import { chatForWorkspace, countTones, nestSpaces, spaceHasSession } from '../herdr-tree'
import type { HerdrTreeGroup, HerdrTreeWorkspace, NativeSession } from '../types'
import HerdrSpace from './HerdrSpace'
import { Chevron, OfflineTag, StatusPips } from './StatusDot'
import { cx, rowHover, touch } from './ui'

interface Props {
  group: HerdrTreeGroup
  open: boolean
  onToggle: () => void
  nativeSessions: NativeSession[]
  currentSessionId?: string | null
  onOpen: (item: NativeSession) => void
  onCopy: (text: string, label: string) => void
}

// A followed herdr session or machine. Linked worktrees nest under their main checkout on a 1px guide.
export default function HerdrGroup({ group, open, onToggle, nativeSessions, currentSessionId, onOpen, onCopy }: Props) {
  const spaces = group.workspaces.length
  const noun = spaces === 1 ? 'space' : 'spaces'
  const row = (workspace: HerdrTreeWorkspace, child = false) => <HerdrSpace key={workspace.id} group={group} workspace={workspace} child={child}
    current={spaceHasSession(workspace, currentSessionId)} chat={chatForWorkspace(group, workspace, nativeSessions)} onOpen={onOpen} onCopy={onCopy} />
  return <div>
    <button type="button" aria-expanded={open} onClick={onToggle} title={`${group.command} · ${spaces} ${noun}${group.reachable ? '' : ' · not reachable'}`}
      className={cx('flex min-h-[34px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-sm font-semibold text-[var(--color-ink)]', touch, rowHover)}>
      <Chevron open={open} />
      <span className={cx('min-w-0 flex-1 truncate', !group.reachable && 'font-medium text-[var(--color-muted)]')}>{group.label}</span>
      {group.reachable ? <StatusPips counts={countTones(group.workspaces)} /> : <OfflineTag />}
      {!open && group.reachable && <span aria-label={`${spaces} ${noun}`} className="shrink-0 text-xs font-medium tabular-nums text-[var(--color-muted)]">{spaces}</span>}
    </button>
    {open && (!group.reachable ? <p className="mb-1.5 ml-7 text-xs text-[var(--color-muted)]">Not reachable right now.</p>
      : !spaces ? <p className="mb-1.5 ml-7 text-xs text-[var(--color-muted)]">No spaces open.</p>
      : <div className="pb-1.5">{nestSpaces(group.workspaces).map(node => <div key={node.workspace.id}>
        {row(node.workspace)}
        {node.children.length > 0 && <div className="relative ml-[33px] before:absolute before:top-0 before:bottom-3.5 before:left-0 before:w-px before:bg-[var(--color-rule)] before:content-['']">
          {node.children.map(kid => row(kid, true))}
        </div>}
      </div>)}</div>)}
  </div>
}
