import { useEffect, useState } from 'react'
import { api } from './api'
import { chatForWorkspace, layoutSpaces, reachableCount, statusMark } from './herdr-tree'
import type { HerdrTreeGroup, NativeSession } from './types'

interface Props {
  nativeSessions: NativeSession[]
  open: boolean
  onToggleSection: () => void
  collapsed: string[]
  onToggle: (id: string) => void
  onOpen: (item: NativeSession) => void
  onCopy: (text: string, label: string) => void
}

// herdr's own sidebar as a left-sidebar section: groups fold, linked worktrees nest.
export default function HerdrTree({ nativeSessions, open, onToggleSection, collapsed, onToggle, onOpen, onCopy }: Props) {
  const [groups, setGroups] = useState<HerdrTreeGroup[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let alive = true
    async function load() {
      try { const data = await api.herdrTree(); if (alive) { setGroups(data.groups); setError('') } }
      catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load herdr') }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [open])
  const count = groups ? reachableCount(groups) : null
  return <section className="herdr-sidebar" aria-label="herdr">
    <button className="section-label herdr-section-head" aria-expanded={open} onClick={onToggleSection}><span>{open ? '▾' : '▸'} herdr</span>{count && <span className="herdr-section-count" title="reachable groups">{count.reachable}/{count.total}</span>}</button>
    {open && (error && !groups ? <p className="sidebar-empty" role="alert">{error}</p> : !groups ? <p className="sidebar-empty">Loading…</p> : <div className="herdr-tree">
      {groups.map(group => {
        const closed = collapsed.includes(group.id)
        return <div className="herdr-tree-group" key={group.id}>
          <button className="herdr-tree-head" aria-expanded={!closed} onClick={() => onToggle(group.id)} title={`${group.command} · ${group.reachable ? 'reachable' : 'unreachable'}`}><span className="caret">{closed ? '▸' : '▾'}</span><span className="label">{group.label}</span><span className={`dot ${group.reachable ? 'up' : 'down'}`} role="img" aria-label={group.reachable ? 'reachable' : 'unreachable'}>●</span></button>
          {!closed && layoutSpaces(group.workspaces).map(({ workspace, tee }) => {
            const chat = chatForWorkspace(group, workspace, nativeSessions)
            const pane = workspace.agents[0]?.paneId
            const command = `${group.command} pane list --workspace ${workspace.id}`
            const title = `${workspace.label}${workspace.branch ? ` · ${workspace.branch}` : ''} · ${workspace.id}${pane ? ` · ${pane}` : ''}${chat ? ' · click to open chat' : ' · click to copy herdr command'}`
            return <button key={workspace.id} className={`herdr-tree-space${tee ? ' kid' : ''}${chat ? ' openable' : ''}`} title={title} onClick={() => chat ? onOpen(chat) : onCopy(command, 'herdr command copied')}>
              {tee && <span className="tee">{tee}</span>}<span className={`mark mark-${workspace.status}`}>{statusMark(workspace.status)}</span>
              <span className="space-text"><span className="space-label">{workspace.label}</span>{workspace.branch && !tee && <span className="space-branch">{workspace.branch}</span>}{tee && workspace.branch && <span className="space-branch">{workspace.branch}</span>}</span>
            </button>
          })}
          {!closed && !group.reachable && <p className="herdr-tree-off">unreachable</p>}
        </div>
      })}
    </div>)}
  </section>
}
