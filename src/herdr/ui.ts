import type { HerdrTone } from '../herdr-tree'

export type Tone = HerdrTone | 'offline'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// Shared Tailwind pieces. Colors are the app's semantic theme variables, so Pop, Light and Dark all work.
export const touch = 'max-[759px]:min-h-11 pointer-coarse:min-h-11'
export const rowHover = 'hover:bg-[var(--color-hover)]'
export const muted = 'text-[var(--color-muted)]'

export const toneText: Record<'needs' | 'working' | 'done', string> = {
  needs: 'text-[var(--color-warning)]',
  working: 'text-[var(--color-accent)]',
  done: 'text-[var(--color-success)]',
}
