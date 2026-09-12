import type { Chat, NativeSession, Project, Repository } from './types'

export interface MentionCandidate {
  key: string
  kind: 'oracle' | 'repository' | 'session'
  name: string
  path: string
  sessionId?: string
  token: string
}

export interface MentionQuery {
  start: number
  end: number
  fragment: string
}

interface MentionSources {
  projects: Project[]
  repositories: Repository[]
  chats: Chat[]
  nativeSessions: NativeSession[]
  cwd: string
  repositoryNames?: Record<string, string>
}

const MAX_REFERENCES = 32
const DEFAULT_MATCH_LIMIT = 8

function normalizedPath(value: string): string {
  if (value === '/') return value
  return value.replace(/[\\/]+$/, '') || value
}

function slug(value: string, fallback: string): string {
  const result = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return result || fallback
}

function boundedSlug(value: string, fallback: string, maxLength: number): string {
  const result = slug(value, fallback).slice(0, maxLength).replace(/-+$/g, '')
  return result || fallback.slice(0, maxLength)
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(-6)
}

function basename(value: string): string {
  const parts = normalizedPath(value).split(/[\\/]/)
  return parts.at(-1) || value
}

function uniqueTokens(
  candidates: Array<Omit<MentionCandidate, 'token'> & { baseToken: string; identity: string }>,
): MentionCandidate[] {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    counts.set(candidate.baseToken, (counts.get(candidate.baseToken) ?? 0) + 1)
  }
  return candidates.map(({ baseToken, identity, ...candidate }) => ({
    ...candidate,
    token: counts.get(baseToken) === 1 ? baseToken : `${baseToken}-${shortHash(identity)}`,
  }))
}

export function buildMentionCandidates({
  projects,
  repositories,
  chats,
  nativeSessions,
  cwd,
  repositoryNames = {},
}: MentionSources): MentionCandidate[] {
  const canonicalPaths = new Map(
    projects.map(project => [normalizedPath(project.path), normalizedPath(project.canonicalPath || project.path)]),
  )
  for (const session of nativeSessions) {
    if (session.cwd) {
      canonicalPaths.set(normalizedPath(session.cwd), normalizedPath(session.canonicalPath || session.cwd))
    }
  }
  const customNames = new Map(
    Object.entries(repositoryNames)
      .map(([repositoryPath, name]) => [normalizedPath(repositoryPath), name.trim()] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  )
  const repositoryGroups = new Map<string, { path: string; repository?: Repository; project?: Project }>()

  for (const repository of repositories) {
    const path = normalizedPath(repository.path)
    const canonical = canonicalPaths.get(path) ?? path
    repositoryGroups.set(canonical, { path: repository.path, repository })
  }
  for (const project of projects) {
    const path = normalizedPath(project.path)
    const canonical = canonicalPaths.get(path) ?? path
    const existing = repositoryGroups.get(canonical)
    repositoryGroups.set(canonical, {
      path: existing?.path ?? project.path,
      repository: existing?.repository,
      project,
    })
  }
  for (const session of nativeSessions) {
    if (!session.cwd) continue
    const path = normalizedPath(session.cwd)
    const canonical = canonicalPaths.get(path) ?? path
    if (!repositoryGroups.has(canonical)) repositoryGroups.set(canonical, { path: session.cwd })
  }
  if (cwd) {
    const path = normalizedPath(cwd)
    const canonical = canonicalPaths.get(path) ?? path
    if (!repositoryGroups.has(canonical)) repositoryGroups.set(canonical, { path: cwd })
  }

  const repositoryCandidates = [...repositoryGroups.entries()].map(([canonical, group]) => {
    const path = group.path
    const name = customNames.get(normalizedPath(path))
      ?? customNames.get(canonical)
      ?? group.project?.name.trim()
      ?? group.repository?.name.trim()
      ?? basename(path)
    return {
      key: `repository:${canonical}`,
      kind: basename(path).toLocaleLowerCase().endsWith('-oracle') ? 'oracle' as const : 'repository' as const,
      name,
      path,
      // Leave room for the deterministic `-xxxxxx` collision suffix.
      baseToken: `@repo:${boundedSlug(name, 'repository', 243)}`,
      identity: canonical,
    }
  })

  const nativeBySession = new Map<string, NativeSession>()
  for (const session of nativeSessions) {
    if (session.sessionId && !nativeBySession.has(session.sessionId)) {
      nativeBySession.set(session.sessionId, session)
    }
  }
  const chatBySession = new Map<string, Chat>()
  for (const chat of chats) {
    if (chat.sessionId && !chatBySession.has(chat.sessionId)) chatBySession.set(chat.sessionId, chat)
  }
  const projectById = new Map(projects.map(project => [project.id, project]))
  const sessionIds = new Set([...nativeBySession.keys(), ...chatBySession.keys()])
  const sessionCandidates = [...sessionIds].flatMap(sessionId => {
    const chat = chatBySession.get(sessionId)
    const native = nativeBySession.get(sessionId)
    const project = chat?.projectId ? projectById.get(chat.projectId) : undefined
    const name = chat?.title.trim() || native?.name?.trim() || `Claude session ${sessionId.slice(0, 8)}`
    // The native cwd is the exact execution path. A saved project's path may be
    // a canonicalized or symlink alias and is only the fallback when inventory
    // no longer contains the native session. A missing named project must not be
    // mislabeled with the unrelated current health cwd.
    const path = native?.cwd || project?.path || ''
    if (!path) return []
    const idPrefix = slug(sessionId.slice(0, 8), shortHash(sessionId))
    return [{
      key: `session:${sessionId}`,
      kind: 'session' as const,
      name,
      path,
      sessionId,
      // Prefix + separator + eight-character ID + collision suffix stays <=256.
      baseToken: `@session:${boundedSlug(name, 'session', 231)}-${idPrefix}`,
      identity: sessionId,
    }]
  })

  return uniqueTokens([...repositoryCandidates, ...sessionCandidates]).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
      || left.key.localeCompare(right.key),
  )
}

export function mentionKindLabel(candidate: MentionCandidate): string {
  switch (candidate.kind) {
    case 'oracle': return 'Oracle'
    case 'repository': return 'Repository'
    case 'session': return 'Session'
  }
}

export function mentionQueryAtCaret(text: string, caret: number): MentionQuery | null {
  const end = Math.max(0, Math.min(caret, text.length))
  const match = text.slice(0, end).match(/(?:^|\s)@([^\s@]*)$/u)
  if (!match) return null
  const start = end - match[1].length - 1
  return { start, end, fragment: match[1] }
}

export function matchMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: MentionQuery | string,
  limit = DEFAULT_MATCH_LIMIT,
): MentionCandidate[] {
  const fragment = (typeof query === 'string' ? query : query.fragment).replace(/^@/, '').toLocaleLowerCase()
  const ranked = candidates
    .map(candidate => {
      const fields = [candidate.name, candidate.path, candidate.sessionId ?? '', candidate.token]
        .map(value => value.toLocaleLowerCase())
      const starts = fields.some(value => value.startsWith(fragment) || value.startsWith(`@${fragment}`))
      const includes = fields.some(value => value.includes(fragment))
      return { candidate, rank: starts ? 0 : includes ? 1 : 2 }
    })
    .filter(item => item.rank < 2)
    .sort((left, right) => left.rank - right.rank)
  return ranked.slice(0, Math.max(0, Math.min(limit, MAX_REFERENCES))).map(item => item.candidate)
}

export function insertMentionToken(
  text: string,
  query: MentionQuery,
  candidate: MentionCandidate,
): { text: string; caret: number } {
  const suffix = text.slice(query.end)
  const separator = suffix.startsWith(' ') ? '' : ' '
  const inserted = `${candidate.token}${separator}`
  return {
    text: `${text.slice(0, query.start)}${inserted}${suffix}`,
    caret: query.start + inserted.length,
  }
}

export function containsCompleteToken(text: string, token: string): boolean {
  let offset = text.indexOf(token)
  while (offset !== -1) {
    const before = text[offset - 1]
    const after = text[offset + token.length]
    const tokenCharacter = /[\p{L}\p{N}_:@-]/u
    if ((!before || !tokenCharacter.test(before)) && (!after || !tokenCharacter.test(after))) return true
    offset = text.indexOf(token, offset + token.length)
  }
  return false
}

export function expandMentionContext(
  text: string,
  selectedCandidates: readonly MentionCandidate[],
): string {
  const references: MentionCandidate[] = []
  const keys = new Set<string>()
  for (const candidate of selectedCandidates) {
    if (references.length >= MAX_REFERENCES) break
    if (keys.has(candidate.key) || !containsCompleteToken(text, candidate.token)) continue
    keys.add(candidate.key)
    references.push(candidate)
  }
  if (references.length === 0) return text
  const metadata = JSON.stringify(references, null, 2).replace(/`/g, '\\u0060')
  return `${text}\n\nReferenced context (metadata only; not conversation history):\n\`\`\`json\n${metadata}\n\`\`\``
}
