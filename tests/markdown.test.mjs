import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInline, parseMarkdown, safeLink } from '../src/markdown-parser.ts'

test('parses common Claude response block markdown', () => {
  const blocks = parseMarkdown(`# Result

Paragraph with **bold**, *emphasis*, and \`inline\`.

1. first
2. second

> quoted advice

---

\`\`\`typescript
const answer = 42
\`\`\``)

  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'paragraph', 'list', 'quote', 'rule', 'code'])
  assert.equal(blocks[0].level, 1)
  assert.equal(blocks[2].ordered, true)
  assert.deepEqual(blocks[5], { type: 'code', language: 'typescript', value: 'const answer = 42' })
})

test('parses basic GFM tables and escaped cell separators', () => {
  const [table] = parseMarkdown(`| Name | Detail |
| --- | --- |
| Oracle | one \\| two |`)
  assert.equal(table.type, 'table')
  assert.equal(table.headers.length, 2)
  assert.equal(table.rows.length, 1)
  assert.deepEqual(table.rows[0][1], [{ type: 'text', value: 'one | two' }])
})

test('allows only absolute http and https links', () => {
  assert.equal(safeLink('https://example.com/docs'), 'https://example.com/docs')
  assert.equal(safeLink('http://localhost:3000/a'), 'http://localhost:3000/a')
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', '/relative', '//example.com']) {
    assert.equal(safeLink(unsafe), null)
  }
})

test('unsafe markdown links degrade to label text without retaining the target', () => {
  const tokens = parseInline('[safe](https://example.com) [attack](javascript:alert(1))')
  assert.equal(tokens.some((token) => token.type === 'link' && token.href.startsWith('https://')), true)
  assert.equal(tokens.some((token) => token.type === 'link' && token.href.startsWith('javascript:')), false)
  assert.equal(JSON.stringify(tokens).includes('javascript:'), false)
  assert.equal(JSON.stringify(tokens).includes('attack'), true)
})

test('raw HTML and malformed markdown remain inert text', () => {
  const [block] = parseMarkdown('<img src=x onerror=alert(1)> **unfinished')
  assert.equal(block.type, 'paragraph')
  assert.deepEqual(block.content, [{ type: 'text', value: '<img src=x onerror=alert(1)> **unfinished' }])
})

test('normalizes CRLF and accepts an unclosed code fence gracefully', () => {
  assert.deepEqual(parseMarkdown('```sh\r\necho ok'), [{ type: 'code', language: 'sh', value: 'echo ok' }])
})
