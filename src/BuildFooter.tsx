import { useEffect, useRef } from 'react'
import { buildInfo } from './build-info'
import { Icon } from './Icon'

export default function BuildFooter() {
  const panel = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (panel.current && !panel.current.contains(event.target as Node)) panel.current.open = false }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel.current?.open) { panel.current.open = false; panel.current.querySelector('summary')?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [])
  return <footer className="build-footer" aria-label="Frontend build version">
    <details ref={panel}>
      <summary aria-label={`UI ${buildInfo.version} — build details`}>
        <span>UI {buildInfo.version}</span>
        <span className="build-time">Build {buildInfo.builtAt ? `${buildInfo.builtAt.slice(11, 23)} UTC` : 'unavailable'}</span>
        <Icon name="info" size={14} />
      </summary>
      <div className="build-details">
        <h2>About this build</h2>
        <dl>
          <dt>UI version</dt><dd>{buildInfo.version}</dd>
          <dt>Built at</dt><dd>{buildInfo.builtAt ? <time dateTime={buildInfo.builtAt}>{buildInfo.builtAt}</time> : 'Unavailable'}</dd>
          <dt>Revision</dt><dd>{buildInfo.revision}</dd>
          <dt>Build ID</dt><dd>{buildInfo.id}</dd>
          <dt>Mode</dt><dd>{buildInfo.mode}</dd>
        </dl>
        <p>Frontend only — this does not confirm a backend connection. Share the build ID when reporting a problem.</p>
      </div>
    </details>
  </footer>
}
