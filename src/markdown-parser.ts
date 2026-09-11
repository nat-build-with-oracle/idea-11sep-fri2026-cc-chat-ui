export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineToken[] }
  | { type: 'emphasis'; children: InlineToken[] }
  | { type: 'link'; href: string; children: InlineToken[] }

export type MarkdownBlock =
  | { type: 'paragraph'; content: InlineToken[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4; content: InlineToken[] }
  | { type: 'code'; language: string | null; value: string }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'quote'; content: InlineToken[] }
  | { type: 'rule' }
  | { type: 'table'; headers: InlineToken[][]; rows: InlineToken[][][] }

const headingPattern = /^(#{1,4})\s+(.+)$/
const fencePattern = /^```([^`]*)$/
const listPattern = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/
const quotePattern = /^\s*>\s?(.*)$/
const rulePattern = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const tableDividerPattern = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/

export function safeLink(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function pushText(tokens: InlineToken[], value: string) {
  if (!value) return
  const previous = tokens.at(-1)
  if (previous?.type === 'text') previous.value += value
  else tokens.push({ type: 'text', value })
}

export function parseInline(input: string, depth = 0): InlineToken[] {
  if (depth > 8) return [{ type: 'text', value: input }]
  const tokens: InlineToken[] = []
  let cursor = 0

  while (cursor < input.length) {
    if (input[cursor] === '\\' && cursor + 1 < input.length) {
      pushText(tokens, input[cursor + 1])
      cursor += 2
      continue
    }

    if (input[cursor] === '`') {
      const end = input.indexOf('`', cursor + 1)
      if (end !== -1) {
        tokens.push({ type: 'code', value: input.slice(cursor + 1, end) })
        cursor = end + 1
        continue
      }
    }

    if (input[cursor] === '[') {
      const labelEnd = input.indexOf('](', cursor + 1)
      const hrefEnd = labelEnd === -1 ? -1 : input.indexOf(')', labelEnd + 2)
      if (labelEnd !== -1 && hrefEnd !== -1) {
        const label = input.slice(cursor + 1, labelEnd)
        const href = safeLink(input.slice(labelEnd + 2, hrefEnd).trim())
        if (href) tokens.push({ type: 'link', href, children: parseInline(label, depth + 1) })
        else pushText(tokens, label)
        cursor = hrefEnd + 1
        continue
      }
    }

    const pair = input.slice(cursor, cursor + 2)
    if (pair === '**' || pair === '__') {
      const end = input.indexOf(pair, cursor + 2)
      if (end > cursor + 2) {
        tokens.push({ type: 'strong', children: parseInline(input.slice(cursor + 2, end), depth + 1) })
        cursor = end + 2
        continue
      }
    }

    if (input[cursor] === '*' || input[cursor] === '_') {
      const marker = input[cursor]
      const end = input.indexOf(marker, cursor + 1)
      if (end > cursor + 1) {
        tokens.push({ type: 'emphasis', children: parseInline(input.slice(cursor + 1, end), depth + 1) })
        cursor = end + 1
        continue
      }
    }

    pushText(tokens, input[cursor])
    cursor += 1
  }

  return tokens
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const character of trimmed) {
    if (character === '|' && !escaped) {
      cells.push(current.trim())
      current = ''
    } else {
      current += character
    }
    escaped = character === '\\' && !escaped
    if (character !== '\\') escaped = false
  }
  cells.push(current.trim())
  return cells
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  return !line.trim()
    || headingPattern.test(line)
    || fencePattern.test(line)
    || rulePattern.test(line)
    || listPattern.test(line)
    || quotePattern.test(line)
    || (line.includes('|') && tableDividerPattern.test(lines[index + 1] ?? ''))
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(fencePattern)
    if (fence) {
      const language = fence[1].trim().match(/^[\w.+-]+/)?.[0] ?? null
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) body.push(lines[index++])
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language, value: body.join('\n') })
      continue
    }

    const heading = line.match(headingPattern)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4, content: parseInline(heading[2]) })
      index += 1
      continue
    }

    if (rulePattern.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    if (line.includes('|') && tableDividerPattern.test(lines[index + 1] ?? '')) {
      const headers = splitTableRow(line).map(parseInline)
      const rows: InlineToken[][][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]).map(parseInline))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    const list = line.match(listPattern)
    if (list) {
      const ordered = Boolean(list[2])
      const items: InlineToken[][] = []
      while (index < lines.length) {
        const item = lines[index].match(listPattern)
        if (!item || Boolean(item[2]) !== ordered) break
        items.push(parseInline(item[3]))
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const quote = line.match(quotePattern)
    if (quote) {
      const quoted: string[] = []
      while (index < lines.length) {
        const part = lines[index].match(quotePattern)
        if (!part) break
        quoted.push(part[1])
        index += 1
      }
      blocks.push({ type: 'quote', content: parseInline(quoted.join('\n')) })
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && !startsBlock(lines, index)) paragraph.push(lines[index++])
    blocks.push({ type: 'paragraph', content: parseInline(paragraph.join('\n')) })
  }

  return blocks
}
