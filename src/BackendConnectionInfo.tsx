import type { ReactNode } from 'react'
import { backendTarget, isLoopback, workspaceLink } from './backend-target'

type BackendConnectionInfoProps = {
  connected: boolean
  href: string
  preview: boolean
  settings: ReactNode
}

export default function BackendConnectionInfo({ connected, href, preview, settings }: BackendConnectionInfoProps) {
  const target = backendTarget(href)
  const local = isLoopback(new URL(target.origin).hostname)
  const status = preview ? 'Design preview' : connected ? local ? 'Local on this Mac' : 'Backend connected' : 'Reconnecting…'

  return <footer className="sidebar-footer">
    <div><span className={`status-dot ${connected ? '' : 'offline'}`} /><span>{status}</span>{settings}</div>
    <a className="backend-target" href={target.origin} target="_blank" rel="noreferrer" aria-label={`Open backend ${target.origin}`}>Backend <span>{target.origin}</span></a>
    {preview ? <a href={workspaceLink(href, false)} className="preview-caption">Design preview · example conversations</a> : <span className="local-caption">Conversations stay on your chosen backend</span>}
  </footer>
}
