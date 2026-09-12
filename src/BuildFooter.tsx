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
  return <footer className="build-footer relative z-30 flex shrink-0 justify-end border-t border-[var(--color-rule)] bg-[var(--color-sidebar)] px-3 pb-[env(safe-area-inset-bottom)] text-xs text-[var(--color-muted)] tabular-nums min-[760px]:px-[18px]" aria-label="Frontend build version">
    <details ref={panel} className="group w-fit max-w-full">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-end gap-x-3 gap-y-1 py-1.5 text-right group-open:text-[var(--color-accent)] hover:text-[var(--color-accent)] min-[760px]:min-h-9 [&::-webkit-details-marker]:hidden" aria-label={`UI ${buildInfo.version} — build details`}>
        <span className="font-semibold text-[var(--color-ink)]">UI {buildInfo.version}</span>
        <span className="build-time">Build {buildInfo.builtAt ? `${buildInfo.builtAt.slice(11, 23)} UTC` : 'unavailable'}</span>
        <Icon name="info" size={14} />
      </summary>
      <div className="build-details absolute right-3 bottom-[calc(100%+8px)] max-h-[min(420px,70dvh)] w-[min(420px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-[var(--color-rule)] bg-[var(--color-panel)] p-5 text-left">
        <h2 className="mb-4 text-base font-semibold text-[var(--color-ink)]">About this build</h2>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-[18px] gap-y-2.5 [&>dt]:m-0! [&>dt]:text-xs! [&>dd]:m-0! [&>dd]:text-xs [&>dd]:wrap-anywhere [&>dd]:text-[var(--color-ink)] [&>dd]:select-text">
          <dt>UI version</dt><dd>{buildInfo.version}</dd>
          <dt>Built at</dt><dd>{buildInfo.builtAt ? <time dateTime={buildInfo.builtAt}>{buildInfo.builtAt}</time> : 'Unavailable'}</dd>
          <dt>Revision</dt><dd>{buildInfo.revision}</dd>
          <dt>Build ID</dt><dd>{buildInfo.id}</dd>
          <dt>Mode</dt><dd>{buildInfo.mode}</dd>
        </dl>
        <p className="mt-4 leading-relaxed">Frontend only — this does not confirm a backend connection. Share the build ID when reporting a problem.</p>
      </div>
    </details>
  </footer>
}
