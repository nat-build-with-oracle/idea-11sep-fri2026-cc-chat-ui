import type { CSSProperties } from 'react'
export type IconName = 'new' | 'search' | 'folder' | 'chevron' | 'plus' | 'arrow' | 'stop' | 'close' | 'panel' | 'info' | 'settings' | 'terminal' | 'message' | 'copy' | 'check' | 'shield' | 'lock' | 'more' | 'download' | 'trash' | 'refresh' | 'agents' | 'file' | 'back' | 'eyeOff'
const paths: Record<IconName, string[]> = {
  eyeOff: ['m3 3 18 18', 'M10.6 10.6a2 2 0 0 0 2.8 2.8', 'M9.9 5.2A11 11 0 0 1 12 5c6 0 10 7 10 7a19 19 0 0 1-3 3.6', 'M6.5 6.5A19 19 0 0 0 2 12s4 7 10 7a11 11 0 0 0 5.5-1.5'],
  new: ['M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7', 'm16 3 5 5-10 10-5 1 1-5Z', 'm14 5 5 5'],
  search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  folder: ['M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z','M3 9h18'],
  chevron: ['m9 5 7 7-7 7'], plus: ['M12 5v14M5 12h14'], arrow: ['M12 20V4m-7 7 7-7 7 7'], stop: ['M6 6h12v12H6Z'],
  close: ['m6 6 12 12M6 18 18 6'], panel: ['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z','M9 3v18'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20','M12 11v6M12 7h.01'],
  settings: ['m9 3 1-1h4l1 3 3 1 3 1v4l-2 2 1 3-2 2-3-1-2 3h-4l-1-3-3-1-2-2 1-3-2-2V6l3-1Z','M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0'],
  terminal: ['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z','m7 8 4 4-4 4m7 0h3'],
  message: ['M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z'],
  copy: ['M9 8h11v13H9Z','M6 16H3V3h11v2'], check: ['m4 12 5 5L20 6'],
  shield: ['m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z','M12 8v5m0 3h.01'], lock: ['M5 10h14v11H5Z','M8 10V6a4 4 0 0 1 8 0v4'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'], download: ['M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  refresh: ['M20 7a9 9 0 1 0 1 8','M20 2v5h-5'],
  agents: ['M9 3h6v6H9ZM3 16h6v6H3Zm12 0h6v6h-6ZM12 9v4M6 16v-3h12v3'],
  file: ['M14 2H5v20h14V7Zm0 0v6h5M8 12h8m-8 4h6'], back: ['M20 12H4m7-7-7 7 7 7'],
}
export function Icon({ name, size = 19, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{paths[name].map((d, i) => <path d={d} key={i} />)}</svg>
}
export function ClaudeMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <path d="M16 4v24" transform={`rotate(${i * 30} 16 16)`} key={i} />)}</svg>
}
