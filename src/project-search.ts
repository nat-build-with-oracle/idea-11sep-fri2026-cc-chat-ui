import type { WorkspaceRepository } from './workspace-model'

export type ProjectSearchScope = 'all' | 'project' | 'oracle'

export function parseProjectSearchScope(value: string): ProjectSearchScope {
  return value === 'project' || value === 'oracle' ? value : 'all'
}

export function isOracleRepository(repo: Pick<WorkspaceRepository, 'path'>): boolean {
  return repo.path.replace(/\/+$/, '').split('/').pop()?.toLocaleLowerCase().endsWith('-oracle') ?? false
}

export function searchRepositories(repositories: readonly WorkspaceRepository[], query: string, scope: ProjectSearchScope): WorkspaceRepository[] {
  const needle = query.trim().replace(/^@/, '').trim().toLocaleLowerCase()
  return repositories.filter(repo => {
    const oracle = isOracleRepository(repo)
    return (scope === 'all' || (scope === 'oracle' ? oracle : !oracle))
      && `${repo.name} ${repo.path}`.toLocaleLowerCase().includes(needle)
  })
}
