import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createRef, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const oracle = { key: 'repository:/work/mother-oracle', kind: 'oracle', name: 'Mother Oracle', path: '/work/mother-oracle', token: '@repo:mother-oracle' }
const repository = { key: 'repository:/work/app', kind: 'repository', name: 'Workbench', path: '/work/app', token: '@repo:workbench' }
const session = { key: 'session:0123456789abcdef', kind: 'session', name: 'Fix login', path: '/work/oracle', sessionId: '0123456789abcdef', token: '@[Fix login](session:0123456789abcdef)' }

async function loadComposer(t) {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  return server.ssrLoadModule('/src/MentionComposer.tsx')
}

test('selected references render as removable, factual chips without conversation-history claims', async t => {
  const { default: MentionComposer } = await loadComposer(t)
  const html = renderToStaticMarkup(createElement(MentionComposer, {
    value: `${oracle.token} ${repository.token} ${session.token} please compare`,
    onChange() {},
    candidates: [oracle, repository, session],
    selected: [oracle, repository, session],
    onSelectedChange() {},
    disabled: false,
    placeholder: 'Message Claude',
    inputRef: createRef(),
  }))

  assert.match(html, /aria-label="Message Claude"/)
  assert.match(html, /aria-autocomplete="list"/)
  assert.match(html, /Remove Mother Oracle reference/)
  assert.match(html, /Mother Oracle<\/span><small>Oracle<\/small>/)
  assert.match(html, /Repository/)
  assert.match(html, /Session · 01234567/)
  assert.doesNotMatch(html, /Mother Oracle<\/span><small>Session/)
  assert.match(html, /References share names, IDs and paths—not conversation history\./)
  assert.match(html, /title="Remove Fix login · \/work\/oracle · 0123456789abcdef"/)
})

test('chip removal deletes only complete matching mention tokens', async t => {
  const { removeMentionFromDraft } = await loadComposer(t)
  assert.equal(removeMentionFromDraft(`Compare ${repository.token} with notes`, repository.token), 'Compare with notes')
  assert.equal(removeMentionFromDraft(`Keep @[Oracle] and ${repository.token}`, repository.token), 'Keep @[Oracle] and')
  assert.equal(removeMentionFromDraft(`Keep ${repository.token}-extended`, repository.token), `Keep ${repository.token}-extended`)
  assert.equal(removeMentionFromDraft('Unmatched prose stays exactly as written', repository.token), 'Unmatched prose stays exactly as written')
})

test('selecting a renamed repository again keeps its persisted mention token binding', async t => {
  const { boundMentionCandidate } = await loadComposer(t)
  const persisted = { ...repository, name: 'Old workbench', token: '@repo:old-workbench' }
  const renamed = { ...repository, name: 'New workbench', token: '@repo:new-workbench' }

  assert.equal(boundMentionCandidate(renamed, [persisted]).token, '@repo:old-workbench')
  assert.equal(boundMentionCandidate(renamed, []).token, '@repo:new-workbench')
})

test('autocomplete keyboard contract guards IME and reserves closed Enter for form submit', async () => {
  const source = await readFile(new URL('../src/MentionComposer.tsx', import.meta.url), 'utf8')
  assert.match(source, /const MAX_SELECTED = 32/)
  assert.match(source, /nativeEvent\.isComposing \|\| event\.keyCode === 229/)
  assert.match(source, /event\.key === 'Enter' && event\.shiftKey/)
  assert.match(source, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/)
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === 'Tab'/)
  assert.match(source, /No matching Oracles, repositories or sessions\./)
  assert.match(source, /Reference limit reached · remove one to add another\./)
  assert.match(source, /event\.currentTarget\.form\?\.requestSubmit\(\)/)
  assert.match(source, /onMouseDown=\{event => event\.preventDefault\(\)\}/)
})

test('slash popup reuses guarded keyboard selection without submitting the form', async () => {
  const source = await readFile(new URL('../src/MentionComposer.tsx', import.meta.url), 'utf8')
  assert.match(source, /slashCommandQueryAtCaret\(text, caret\)/)
  assert.match(source, /Choose a slash command action/)
  assert.match(source, /<span className="slash-kind">Command<\/span>/)
  assert.match(source, /Action · \{command\.description\}/)
  assert.match(source, /if \(optionCount && \(event\.key === 'Enter' \|\| event\.key === 'Tab'\)\) \{/)
  const chooseSlashStart = source.indexOf('function chooseSlash')
  const chooseSlash = source.slice(chooseSlashStart, source.indexOf('function remove', chooseSlashStart))
  assert.match(chooseSlash, /onChange\(inserted\.text\)/)
  assert.match(chooseSlash, /setSlashQuery\(null\)/)
  assert.doesNotMatch(chooseSlash, /requestSubmit/)
  assert.ok(source.indexOf('if (optionCount &&') < source.indexOf('form?.requestSubmit()'))
})

test('selection events preserve keyboard position when the active query is unchanged', async t => {
  const { sameComposerQuery } = await loadComposer(t)
  const query = { start: 0, end: 1, fragment: '' }
  assert.equal(sameComposerQuery(query, { ...query }), true)
  assert.equal(sameComposerQuery(query, { ...query, fragment: 'r' }), false)
  assert.equal(sameComposerQuery(query, null), false)

  const source = await readFile(new URL('../src/MentionComposer.tsx', import.meta.url), 'utf8')
  assert.match(source, /if \(resetActive && queryChanged\) setActiveIndex\(0\)/)
  assert.match(source, /updateQuery\(next, event\.currentTarget\.selectionStart, true\)/)
  assert.match(source, /onSelect=\{event => updateQuery\(event\.currentTarget\.value, event\.currentTarget\.selectionStart\)\}/)
  assert.doesNotMatch(source, /setSlashQuery\(slash\)\s*setActiveIndex\(0\)/)
})
