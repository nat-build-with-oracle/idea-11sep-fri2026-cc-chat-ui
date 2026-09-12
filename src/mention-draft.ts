import { containsCompleteToken, type MentionCandidate } from './mentions.ts'

export interface MentionBinding {
  key: string
  token?: string
}

const MAX_BINDINGS = 32
const MAX_RAW_LENGTH = 16_384

function hasControlCharacter(value: string): boolean {
  return [...value].some(character => (character.codePointAt(0) ?? 0) < 32)
}

function validKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1_024
    && (/^repository:.+$/u.test(value) || /^session:.+$/u.test(value))
    && !hasControlCharacter(value)
}

function validToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && /^@(?:repo|session):\S+$/u.test(value)
    && !hasControlCharacter(value)
}

export function parseMentionBindings(raw: string): MentionBinding[] {
  if (!raw || raw.length > MAX_RAW_LENGTH) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const bindings: MentionBinding[] = []
  const keys = new Set<string>()
  for (const value of parsed) {
    const binding = typeof value === 'string'
      ? (validKey(value) ? { key: value } : null)
      : value && typeof value === 'object' && !Array.isArray(value)
        ? (() => {
            const record = value as Record<string, unknown>
            if (!validKey(record.key)) return null
            if (record.token !== undefined && !validToken(record.token)) return null
            return record.token === undefined ? { key: record.key } : { key: record.key, token: record.token }
          })()
        : null
    if (!binding || keys.has(binding.key)) continue
    keys.add(binding.key)
    bindings.push(binding)
    if (bindings.length === MAX_BINDINGS) break
  }
  return bindings
}

export function resolveMentionBindings(
  bindings: readonly MentionBinding[],
  candidates: readonly MentionCandidate[],
  text: string,
): MentionCandidate[] {
  const candidatesByKey = new Map(candidates.map(candidate => [candidate.key, candidate]))
  const resolved: MentionCandidate[] = []
  const keys = new Set<string>()
  for (const binding of bindings) {
    if (resolved.length === MAX_BINDINGS || keys.has(binding.key)) continue
    const candidate = candidatesByKey.get(binding.key)
    if (!candidate) continue
    const token = binding.token ?? candidate.token
    if (!validToken(token) || !containsCompleteToken(text, token)) continue
    keys.add(binding.key)
    resolved.push({ ...candidate, token })
  }
  return resolved
}

export function mentionBindings(selected: readonly MentionCandidate[]): MentionBinding[] {
  const bindings: MentionBinding[] = []
  const keys = new Set<string>()
  for (const candidate of selected) {
    if (bindings.length === MAX_BINDINGS || keys.has(candidate.key)) continue
    if (!validKey(candidate.key) || !validToken(candidate.token)) continue
    keys.add(candidate.key)
    bindings.push({ key: candidate.key, token: candidate.token })
  }
  return bindings
}
