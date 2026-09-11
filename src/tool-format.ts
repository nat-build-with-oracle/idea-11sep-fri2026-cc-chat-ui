export type ToolValueLanguage = 'shell' | 'json' | 'text'

export interface FormattedToolInput {
  label: string
  language: ToolValueLanguage
  content: string
  raw: string
  hasRaw: boolean
}

export interface FormattedToolResult {
  language: 'json' | 'text'
  content: string
  raw: string
  hasRaw: boolean
}

export interface ShellHighlightToken {
  type: 'plain' | 'string' | 'variable' | 'operator' | 'comment'
  text: string
}

function stringifyFallback(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[Unserializable value]'
  }
}

export function serializeToolValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value, null, 2)
    return serialized === undefined ? stringifyFallback(value) : serialized
  } catch {
    return stringifyFallback(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsedJsonContainer(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function formatGeneralValue(value: unknown): {
  language: 'json' | 'text'
  content: string
  raw: string
  hasRaw: boolean
} {
  const raw = serializeToolValue(value)
  if (typeof value === 'object' && value !== null) {
    return { language: 'json', content: raw, raw, hasRaw: false }
  }
  if (typeof value === 'string') {
    const parsed = parsedJsonContainer(value)
    if (parsed !== undefined) {
      const content = serializeToolValue(parsed)
      return { language: 'json', content, raw, hasRaw: content !== raw }
    }
  }
  return { language: 'text', content: raw, raw, hasRaw: false }
}

export function formatToolInput(name: string, input: unknown): FormattedToolInput {
  const raw = serializeToolValue(input)
  if (name === 'Bash' && isRecord(input) && typeof input.command === 'string') {
    return {
      label: 'Command',
      language: 'shell',
      content: input.command,
      raw,
      hasRaw: true,
    }
  }

  return { label: 'Input', ...formatGeneralValue(input) }
}

export function formatToolResult(value: unknown): FormattedToolResult {
  return formatGeneralValue(value)
}

function isVariableNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || character === '_'
}

function isOperatorCharacter(character: string): boolean {
  return character === '&' || character === '|' || character === ';'
    || character === '<' || character === '>' || character === '(' || character === ')'
}

function isShellWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

function variableEnd(source: string, start: number): number {
  if (source[start] !== '$' || start + 1 >= source.length) return start
  const next = source[start + 1]
  if (next === '{') {
    let cursor = start + 2
    while (cursor < source.length && source[cursor] !== '}') cursor += 1
    return cursor < source.length ? cursor + 1 : source.length
  }
  if (next === '?' || next === '!' || next === '#' || next === '$' || next === '-' || next === '@' || next === '*') {
    return start + 2
  }
  if (!isVariableNameCharacter(next)) return start
  let cursor = start + 2
  while (cursor < source.length && isVariableNameCharacter(source[cursor])) cursor += 1
  return cursor
}

/**
 * A lossless, best-effort shell display tokenizer. It deliberately does not
 * validate shell syntax or assign execution meaning to the source.
 */
export function highlightShell(source: string): ShellHighlightToken[] {
  const tokens: ShellHighlightToken[] = []
  const push = (type: ShellHighlightToken['type'], text: string) => {
    if (!text) return
    const previous = tokens.at(-1)
    if (previous?.type === type) previous.text += text
    else tokens.push({ type, text })
  }

  let cursor = 0
  while (cursor < source.length) {
    const character = source[cursor]

    if (character === '\\') {
      const end = Math.min(cursor + 2, source.length)
      push('plain', source.slice(cursor, end))
      cursor = end
      continue
    }

    if (character === "'" || character === '`') {
      const quote = character
      const start = cursor++
      while (cursor < source.length) {
        if (source[cursor] === '\\' && quote === '`') cursor = Math.min(cursor + 2, source.length)
        else if (source[cursor++] === quote) break
      }
      push('string', source.slice(start, cursor))
      continue
    }

    if (character === '"') {
      let segmentStart = cursor++
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor = Math.min(cursor + 2, source.length)
          continue
        }
        if (source[cursor] === '$') {
          const end = variableEnd(source, cursor)
          if (end > cursor) {
            push('string', source.slice(segmentStart, cursor))
            push('variable', source.slice(cursor, end))
            cursor = end
            segmentStart = cursor
            continue
          }
        }
        if (source[cursor++] === '"') break
      }
      push('string', source.slice(segmentStart, cursor))
      continue
    }

    if (character === '$') {
      const end = variableEnd(source, cursor)
      if (end > cursor) {
        push('variable', source.slice(cursor, end))
        cursor = end
        continue
      }
    }

    if (character === '#' && (cursor === 0 || isShellWhitespace(source[cursor - 1]) || isOperatorCharacter(source[cursor - 1]))) {
      const start = cursor
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1
      push('comment', source.slice(start, cursor))
      continue
    }

    if (isOperatorCharacter(character)) {
      const start = cursor++
      while (cursor < source.length && isOperatorCharacter(source[cursor])) cursor += 1
      push('operator', source.slice(start, cursor))
      continue
    }

    const start = cursor++
    while (cursor < source.length) {
      const next = source[cursor]
      if (next === '\\' || next === "'" || next === '`' || next === '"' || next === '$'
        || isOperatorCharacter(next)
        || (next === '#' && (isShellWhitespace(source[cursor - 1]) || isOperatorCharacter(source[cursor - 1])))) break
      cursor += 1
    }
    push('plain', source.slice(start, cursor))
  }

  return tokens
}
