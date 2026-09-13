import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Icon } from './Icon'
import { isOracleRepository, searchRepositories, type ProjectSearchScope } from './project-search'
import type { WorkspaceRepository } from './workspace-model'

interface ProjectSearchProps {
  repositories: readonly WorkspaceRepository[]
  scope: ProjectSearchScope
  onScopeChange: (scope: ProjectSearchScope) => void
  onSelect: (repo: WorkspaceRepository) => void
  inputRef: RefObject<HTMLInputElement | null>
  loading: boolean
  warning?: string
}

export default function ProjectSearch({ repositories, scope, onScopeChange, onSelect, inputRef, loading, warning }: ProjectSearchProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listId = useId()
  const activeOption = useRef<HTMLButtonElement>(null)
  const matches = searchRepositories(repositories, query, scope)
  const visible = matches.slice(0, 100)
  const index = Math.min(activeIndex, Math.max(0, visible.length - 1))
  const activeId = visible[index]?.id

  useEffect(() => { activeOption.current?.scrollIntoView({ block: 'nearest' }) }, [index, activeId])

  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (visible.length) setActiveIndex((index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (visible[index]) onSelect(visible[index])
    }
  }

  return <div className="project-search">
    <label className="search-input"><Icon name="search" /><input ref={inputRef} autoFocus role="combobox" aria-label="Search projects and Oracles" aria-autocomplete="list" aria-expanded={visible.length > 0} aria-controls={listId} aria-activedescendant={activeId ? `${listId}-${index}` : undefined} aria-describedby={`${listId}-help`} placeholder="Search a name, path, or @oracle…" autoComplete="off" spellCheck={false} value={query} onChange={event => { setQuery(event.target.value); setActiveIndex(0) }} onKeyDown={keydown} /><kbd>⌘K</kbd></label>
    <div className="project-search-scopes" role="group" aria-label="Search scope">{([['all', 'All'], ['project', 'Projects'], ['oracle', 'Oracles']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => { onScopeChange(value); setActiveIndex(0); inputRef.current?.focus() }}>{label}</button>)}</div>
    <div id={listId} role="listbox" aria-label="Matching projects and Oracles" className="search-results project-search-results">
      {visible.map((repo, row) => <button type="button" key={repo.id} id={`${listId}-${row}`} role="option" aria-selected={row === index} ref={row === index ? activeOption : undefined} tabIndex={-1} onClick={() => onSelect(repo)}>
        <Icon name={isOracleRepository(repo) ? 'agents' : 'folder'} />
        <span><strong>{repo.name}</strong><small title={repo.path}>{repo.path}</small></span>
        <small className="project-search-kind">{isOracleRepository(repo) ? 'Oracle' : 'Project'}</small>
        <Icon name="chevron" size={14} />
      </button>)}
    </div>
    {!visible.length && <p className="search-empty" role="status">{loading ? 'Finding projects and Oracles…' : 'No matches. Try another name or search scope.'}</p>}
    {warning && <p className="field-help" role="status">{warning}</p>}
    <p id={`${listId}-help`} className="project-search-help"><span>{matches.length > visible.length ? `First ${visible.length} of ${matches.length} matches — type to narrow.` : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`}</span><span>↑↓ choose · Enter opens a new chat · Esc closes</span></p>
  </div>
}
