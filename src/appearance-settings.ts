export const themes = ['pop', 'light', 'dark'] as const
export const textSizes = ['comfortable', 'large'] as const
export type Theme = typeof themes[number]
export type TextSize = typeof textSizes[number]
export type AppearanceSettings = { theme: Theme; textSize: TextSize }
export const appearanceStorageKey = 'cc:appearance'
export const defaultAppearance: AppearanceSettings = { theme: 'pop', textSize: 'comfortable' }
export const themeColors: Record<Theme, string> = {
  pop: '#f5f5fc',
  light: '#f8fafc',
  dark: '#171923',
}

export function parseAppearance(raw: string | null): AppearanceSettings {
  try {
    const value = JSON.parse(raw || '{}')
    return {
      theme: themes.includes(value?.theme) ? value.theme : defaultAppearance.theme,
      textSize: textSizes.includes(value?.textSize) ? value.textSize : defaultAppearance.textSize,
    }
  } catch { return { ...defaultAppearance } }
}

export function themeColorFor(theme: Theme) { return themeColors[theme] }
