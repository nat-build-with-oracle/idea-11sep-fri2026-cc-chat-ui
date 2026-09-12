import type { WorkspaceRepository } from './workspace-model'

export interface RepositoryPreferences {
  favorites: Set<string>
  names: Map<string, string>
  threadSorts: Map<string, RepositoryThreadSort>
}

export type RepositoryThreadSort = 'updated' | 'name'

const normalizePath = (value: string) => value.replace(/\/+$/, '') || '/'
const hasControls = (value: string) => Array.from(value).some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)

function repositoryPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || hasControls(value)) return null
  return normalizePath(value)
}

function repositoryName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 120 && !hasControls(trimmed) ? trimmed : null
}

export function parseRepositoryPreferences(raw: string): RepositoryPreferences {
  const empty = (): RepositoryPreferences => ({ favorites: new Set(), names: new Map(), threadSorts: new Map() })
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty()
    const record = parsed as Record<string, unknown>
    const favorites = new Set<string>()
    if (Array.isArray(record.favorites)) {
      for (const value of record.favorites) {
        const path = repositoryPath(value)
        if (path) favorites.add(path)
      }
    }
    const names = new Map<string, string>()
    if (record.names && typeof record.names === 'object' && !Array.isArray(record.names)) {
      for (const [key, value] of Object.entries(record.names)) {
        const path = repositoryPath(key)
        const name = repositoryName(value)
        if (path && name) names.set(path, name)
      }
    }
    const threadSorts = new Map<string, RepositoryThreadSort>()
    if (record.threadSorts && typeof record.threadSorts === 'object' && !Array.isArray(record.threadSorts)) {
      for (const [key, value] of Object.entries(record.threadSorts)) {
        const path = repositoryPath(key)
        if (path && (value === 'updated' || value === 'name')) threadSorts.set(path, value)
      }
    }
    return { favorites, names, threadSorts }
  } catch {
    return empty()
  }
}

export function serializeRepositoryPreferences(preferences: RepositoryPreferences): string {
  const favorites = [...preferences.favorites]
    .map(repositoryPath)
    .filter((value): value is string => value !== null)
    .sort()
  const names: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [rawPath, rawName] of [...preferences.names].sort(([a], [b]) => a.localeCompare(b))) {
    const path = repositoryPath(rawPath)
    const name = repositoryName(rawName)
    if (path && name) names[path] = name
  }
  const threadSorts: Record<string, RepositoryThreadSort> = Object.create(null) as Record<string, RepositoryThreadSort>
  for (const [rawPath, sort] of [...(preferences.threadSorts ?? [])].sort(([a], [b]) => a.localeCompare(b))) {
    const path = repositoryPath(rawPath)
    if (path && (sort === 'updated' || sort === 'name')) threadSorts[path] = sort
  }
  return JSON.stringify({ favorites: [...new Set(favorites)], names, ...(Object.keys(threadSorts).length ? { threadSorts } : {}) })
}

export function setRepositoryFavorite(preferences: RepositoryPreferences, rawPath: string, value: boolean): RepositoryPreferences {
  const favorites = new Set(preferences.favorites)
  const path = repositoryPath(rawPath)
  if (path) {
    if (value) favorites.add(path)
    else favorites.delete(path)
  }
  return { favorites, names: new Map(preferences.names), threadSorts: new Map(preferences.threadSorts ?? []) }
}

export function setRepositoryName(preferences: RepositoryPreferences, rawPath: string, rawLabel: string): RepositoryPreferences {
  const names = new Map(preferences.names)
  const path = repositoryPath(rawPath)
  if (path) {
    if (!hasControls(rawLabel) && !rawLabel.trim()) names.delete(path)
    else {
      const label = repositoryName(rawLabel)
      if (label) names.set(path, label)
    }
  }
  return { favorites: new Set(preferences.favorites), names, threadSorts: new Map(preferences.threadSorts ?? []) }
}

export function setRepositoryThreadSort(preferences: RepositoryPreferences, rawPath: string, sort: RepositoryThreadSort): RepositoryPreferences {
  const threadSorts = new Map(preferences.threadSorts)
  const path = repositoryPath(rawPath)
  if (path && (sort === 'updated' || sort === 'name')) threadSorts.set(path, sort)
  return { favorites: new Set(preferences.favorites), names: new Map(preferences.names), threadSorts }
}

export function applyRepositoryPreferences(rows: readonly WorkspaceRepository[], preferences: RepositoryPreferences): WorkspaceRepository[] {
  const projected = rows.map(row => {
    const path = repositoryPath(row.path)
    return { ...row, name: (path && preferences.names.get(path)) || row.name }
  })
  return [
    ...projected.filter(row => preferences.favorites.has(normalizePath(row.path))),
    ...projected.filter(row => !preferences.favorites.has(normalizePath(row.path))),
  ]
}
