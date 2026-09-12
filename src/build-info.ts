export interface BuildInfo {
  version: string
  builtAt: string
  revision: string
  id: string
  mode: 'development' | 'production'
}

declare global {
  const __BUILD_INFO__: BuildInfo
}

export const buildInfo: BuildInfo = typeof __BUILD_INFO__ === 'undefined'
  ? { version: 'unbuilt', builtAt: '', revision: 'unknown', id: 'unbuilt', mode: 'development' }
  : __BUILD_INFO__
