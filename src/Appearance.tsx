import { useEffect, useRef, useState } from 'react'
import { appearanceStorageKey, parseAppearance, themeColorFor, themes, type AppearanceSettings, type TextSize } from './appearance-settings'

const labels = { pop: 'Pop', light: 'Light', dark: 'Dark' }
export default function Appearance() {
  const [settings, setSettings] = useState<AppearanceSettings>(() => {
    try { return parseAppearance(localStorage.getItem(appearanceStorageKey)) } catch { return parseAppearance(null) }
  })
  const panel = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.textSize = settings.textSize
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', themeColorFor(settings.theme))
    try { localStorage.setItem(appearanceStorageKey, JSON.stringify(settings)) } catch { /* Preferences still work without storage. */ }
  }, [settings])
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => { if (panel.current && !panel.current.contains(event.target as Node)) panel.current.open = false }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && panel.current?.open) { panel.current.open = false; panel.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', escape) }
  }, [])
  return <details className="appearance" ref={panel}>
    <summary className="appearance-trigger" aria-label="Appearance settings"><span className="theme-swatch" /><span>Theme</span></summary>
    <div className="appearance-panel">
      <h2>Make it yours</h2><p>A little more you. Just as focused.</p>
      <div className="theme-options" role="group" aria-label="Color theme">{themes.map(theme => <button type="button" key={theme} aria-pressed={settings.theme === theme} onClick={() => setSettings(previous => ({ ...previous, theme }))}><span className={`theme-sample theme-sample-${theme}`} /><strong>{labels[theme]}</strong></button>)}</div>
      <label className="appearance-size">Reading size<select aria-label="Reading size" value={settings.textSize} onChange={event => setSettings(previous => ({ ...previous, textSize: event.target.value as TextSize }))}><option value="comfortable">Comfortable</option><option value="large">Larger</option></select></label>
      <small>Saved on this browser. Applies to every conversation.</small>
    </div>
  </details>
}
