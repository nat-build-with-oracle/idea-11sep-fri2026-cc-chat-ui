const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/'

export function parseHiddenRepositories(value: string): Set<string> {
  try {
    const paths: unknown = JSON.parse(value)
    if (!Array.isArray(paths)) return new Set()
    return new Set(paths.filter((path): path is string => typeof path === 'string' && path.startsWith('/') && Array.from(path).every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)).map(normalizePath))
  } catch { return new Set() }
}

/** Visibility is keyed by directory, not by a transient discovery or saved ID. */
export function changeRepositoryVisibility(paths: ReadonlySet<string>, path: string, hidden: boolean): Set<string> {
  const next = new Set(paths)
  if (hidden) next.add(normalizePath(path)); else next.delete(normalizePath(path))
  return next
}
