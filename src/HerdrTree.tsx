import { useEffect, useState } from 'react'
import { api } from './api'
import { chatForWorkspace, reachableCount, statusMark } from './herdr-tree'
import type { HerdrTreeGroup, NativeSession } from './types'

interface Props {
  nativeSessions: NativeSession[]
  collapsed: string[]
  onToggle: (id: string) => void
  onOpen: (item: NativeSession) => void
  onCopy: (text: string, label: string) => void
}

export default function HerdrTree({ nativeSessions, collapsed, onToggle, onOpen, onCopy }: Props) {
  const [groups, setGroups] = useState<HerdrTreeGroup[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    async function load() {
      try { const data = await api.herdrTree(); if (alive) { setGroups(data.groups); setError('') } }
      catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load the herdr tree') }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])
  if (error && !groups) return <p className="inline-error" role="alert">{error}</p>
  if (!groups) return <div className="skeleton-lines"><i /><i /><i /></div>
  const { reachable, total } = reachableCount(groups)
  return <div className="herdr-tree" aria-label="herdr tree">
    <p className="herdr-tree-note">{reachable}/{total} reachable · read-only view of herdr</p>
    {groups.map(group => {
      const closed = collapsed.includes(group.id)
      return <section className="herdr-tree-group" key={group.id}>
        <button className="herdr-tree-head" aria-expanded={!closed} onClick={() => onToggle(group.id)} title={group.command}><span className="caret">{closed ? '▸' : '▾'}</span><span className="label">{group.label}</span><span className={`dot ${group.reachable ? 'up' : 'down'}`} role="img" aria-label={group.reachable ? 'reachable' : 'unreachable'}>●</span></button>
        {!closed && group.workspaces.map(workspace => {
          const chat = chatForWorkspace(group, workspace, nativeSessions)
          const pane = workspace.agents[0]?.paneId
          const body = <><span className={`mark mark-${workspace.status}`}>{statusMark(workspace.status)}</span><span className="space-text"><span className="space-label">{workspace.label}</span>{workspace.branch && <span className="space-branch">{workspace.branch}</span>}</span></>
          return chat
            ? <button key={workspace.id} className="herdr-tree-space openable" onClick={() => onOpen(chat)} title="Open this chat">{body}</button>
            : <button key={workspace.id} className="herdr-tree-space" onClick={() => onCopy(`${group.command} agent list${pane ? `  # ${pane}` : ''}`, 'herdr command copied')} title={`${group.command} · ${workspace.id}${pane ? ` · ${pane}` : ''} · click to copy`}>{body}</button>
        })}
        {!closed && !group.reachable && <p className="herdr-tree-off">unreachable</p>}
      </section>
    })}
  </div>
}
