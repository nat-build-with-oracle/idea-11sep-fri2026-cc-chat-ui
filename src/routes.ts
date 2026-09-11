type SessionTab = 'agents' | 'terminals' | 'saved'

export type AppRoute =
  | { view: 'new'; projectId: string | null }
  | { view: 'chat'; chatId: string }
  | { view: 'agents'; tab: SessionTab; search: string }
  | { view: 'native'; sessionId: string; tab: SessionTab; search: string }

const NEW_ROUTE: AppRoute = { view: 'new', projectId: null }

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function validIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !hasControlCharacter(value) && !value.includes('/')
}

function validProjectId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !hasControlCharacter(value)
}

function decodePathPart(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function sessionTab(value: string | null): SessionTab {
  return value === 'terminals' || value === 'saved' ? value : 'agents'
}

function sessionQuery(query: string): { tab: SessionTab; search: string } {
  const params = new URLSearchParams(query)
  return { tab: sessionTab(params.get('tab')), search: (params.get('q') ?? '').slice(0, 500) }
}

export function parseRoute(hash: string): AppRoute {
  const source = hash.startsWith('#') ? hash.slice(1) : hash
  const queryStart = source.indexOf('?')
  const path = queryStart === -1 ? source : source.slice(0, queryStart)
  const query = queryStart === -1 ? '' : source.slice(queryStart + 1)

  if (path === '/new') {
    const projectId = new URLSearchParams(query).get('project')
    if (projectId === null || projectId === '') return NEW_ROUTE
    return validProjectId(projectId) ? { view: 'new', projectId } : NEW_ROUTE
  }

  if (path === '/sessions') return { view: 'agents', ...sessionQuery(query) }

  const chatMatch = /^\/chats\/([^/]+)$/u.exec(path)
  if (chatMatch) {
    const chatId = decodePathPart(chatMatch[1])
    return chatId !== null && validIdentifier(chatId) ? { view: 'chat', chatId } : NEW_ROUTE
  }

  const sessionMatch = /^\/sessions\/([^/]+)$/u.exec(path)
  if (sessionMatch) {
    const sessionId = decodePathPart(sessionMatch[1])
    return sessionId !== null && validIdentifier(sessionId)
      ? { view: 'native', sessionId, ...sessionQuery(query) }
      : NEW_ROUTE
  }

  return NEW_ROUTE
}

function sessionsHash(tab: SessionTab, search: string): string {
  const params = new URLSearchParams()
  if (tab !== 'agents') params.set('tab', tab)
  if (search) params.set('q', search.slice(0, 500))
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function routeHash(route: AppRoute): string {
  switch (route.view) {
    case 'new': {
      if (route.projectId === null) return '#/new'
      if (!validProjectId(route.projectId)) return '#/new'
      const params = new URLSearchParams({ project: route.projectId })
      return `#/new?${params.toString()}`
    }
    case 'chat':
      return validIdentifier(route.chatId) ? `#/chats/${encodeURIComponent(route.chatId)}` : '#/new'
    case 'agents':
      return `#/sessions${sessionsHash(route.tab, route.search)}`
    case 'native':
      return validIdentifier(route.sessionId)
        ? `#/sessions/${encodeURIComponent(route.sessionId)}${sessionsHash(route.tab, route.search)}`
        : '#/new'
  }
}
