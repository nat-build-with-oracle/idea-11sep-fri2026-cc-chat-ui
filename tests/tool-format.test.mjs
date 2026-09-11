import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatToolInput,
  formatToolResult,
  highlightShell,
  serializeToolValue,
} from '../src/tool-format.ts'

test('serializes strings verbatim and values as readable JSON', () => {
  assert.equal(serializeToolValue('line one\nline two'), 'line one\nline two')
  assert.equal(serializeToolValue({ okay: true, count: 2 }), '{\n  "okay": true,\n  "count": 2\n}')
  assert.equal(serializeToolValue(undefined), 'undefined')
})

test('formats Bash command input without JSON escape cruft while retaining the full raw value', () => {
  const input = {
    command: 'cd /tmp && echo "hello"\nprintf \'%s\\n\' "$HOME"',
    timeout: 2_000,
  }
  const formatted = formatToolInput('Bash', input)

  assert.deepEqual(formatted, {
    label: 'Command',
    language: 'shell',
    content: input.command,
    raw: JSON.stringify(input, null, 2),
    hasRaw: true,
  })
})

test('keeps non-Bash tool inputs complete instead of extracting a convenient path', () => {
  const input = { file_path: '/repo/src/App.tsx', offset: 20, limit: 80 }
  assert.deepEqual(formatToolInput('Read', input), {
    label: 'Input',
    language: 'json',
    content: JSON.stringify(input, null, 2),
    raw: JSON.stringify(input, null, 2),
    hasRaw: false,
  })
  assert.deepEqual(formatToolInput('Custom', 'plain input'), {
    label: 'Input',
    language: 'text',
    content: 'plain input',
    raw: 'plain input',
    hasRaw: false,
  })
})

test('pretty prints object results and JSON container strings without coercing JSON primitives', () => {
  assert.deepEqual(formatToolResult({ hits: ['one', 'two'] }), {
    language: 'json',
    content: '{\n  "hits": [\n    "one",\n    "two"\n  ]\n}',
    raw: '{\n  "hits": [\n    "one",\n    "two"\n  ]\n}',
    hasRaw: false,
  })

  assert.deepEqual(formatToolResult(' {"ok":true,"rows":[1]} '), {
    language: 'json',
    content: '{\n  "ok": true,\n  "rows": [\n    1\n  ]\n}',
    raw: ' {"ok":true,"rows":[1]} ',
    hasRaw: true,
  })

  assert.equal(formatToolResult('true').language, 'text')
  assert.equal(formatToolResult('42').language, 'text')
  assert.equal(formatToolResult('"hello"').language, 'text')
})

test('shell highlighting is lossless across quotes, variables, operators, comments, escapes, and unicode', () => {
  const source = 'cd "a && b" && echo "$HOME" \'$USER\' foo\\#bar # note ไทย\nprintf "say \\"hi\\"" > "$OUT"'
  const tokens = highlightShell(source)

  assert.equal(tokens.map(token => token.text).join(''), source)
  assert.ok(tokens.some(token => token.type === 'string' && token.text === '"a && b"'))
  assert.ok(tokens.some(token => token.type === 'operator' && token.text === '&&'))
  assert.ok(tokens.some(token => token.type === 'variable' && token.text === '$HOME'))
  assert.ok(tokens.some(token => token.type === 'string' && token.text === "'$USER'"))
  assert.ok(tokens.some(token => token.type === 'comment' && token.text === '# note ไทย'))
})

test('shell highlighting handles multiline and unterminated constructs without throwing or losing bytes', () => {
  for (const source of [
    'echo ${HOME}\n# next\ncat < file',
    'echo "unterminated $HOME',
    'echo \'unterminated ไทย',
    'printf %s "$A"; echo $?',
    '',
  ]) {
    assert.equal(highlightShell(source).map(token => token.text).join(''), source)
  }
})

test('shell display never drops bytes across deterministic mixed input', () => {
  const characters = 'ab $\'"`\\\n#&|;()<>ไทย{}012'
  let seed = 71
  for (let example = 0; example < 500; example += 1) {
    let source = ''
    for (let index = 0; index < 80; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      source += characters[seed % characters.length]
    }
    assert.equal(highlightShell(source).map(token => token.text).join(''), source)
  }
})
