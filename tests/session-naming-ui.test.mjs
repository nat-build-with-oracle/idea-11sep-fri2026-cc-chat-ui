import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

test('naming dialog is opt-in, Claude-only, and has no automatic selection or rename', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => vite.close())
  const { default: Names } = await vite.ssrLoadModule('/src/SessionNameSuggestions.tsx')
  const { RepositoryActions } = await vite.ssrLoadModule('/src/SidebarActions.tsx')
  const candidates = [{ target: { kind: 'native', id: 'native-123' }, title: 'kvm-oracle' }, { target: { kind: 'chat', id: 'chat-456' }, title: 'Black and white local' }]
  const props = { candidates, capability: { summaryModels: ['haiku', 'sonnet'], namingModel: 'opus' }, onClose() {}, onApplied() {} }
  const markup = renderToStaticMarkup(createElement(Names, props))
  assert.match(markup, /Suggest session names/)
  assert.match(markup, /Haiku or Sonnet summarizes/)
  assert.match(markup, /Opus proposes three names/)
  assert.match(markup, /Two model calls; normal usage charges apply/)
  assert.match(markup, /No tools, session resume, or automatic renaming/)
  assert.match(markup, /value="native:native-123"/)
  assert.match(markup, /value="chat:chat-456"/)
  assert.match(markup, />Generate suggestions<\/button>/)
  assert.doesNotMatch(markup, /Save alias<\/button>/)
  assert.doesNotMatch(markup, /GLM|provider routing|session.s provider/i)
  const oldBackend = renderToStaticMarkup(createElement(Names, { ...props, capability: undefined }))
  assert.match(oldBackend, /backend needs the session-naming update/)
  assert.match(oldBackend, /disabled=""[^>]*>Generate suggestions/)
  const menu = renderToStaticMarkup(createElement(RepositoryActions, { name: 'kvm-oracle', favorite: false, threadSort: 'updated', onFavorite() {}, onRename() {}, onThreadSort() {}, onHide() {}, onSuggestNames() {} }))
  assert.match(menu, /Suggest session names/)
})

test('naming uses dedicated alias endpoint, aborts generation, and keeps stale-title protection', async () => {
  const source = await readFile(new URL('../src/SessionNameSuggestions.tsx', import.meta.url), 'utf8')
  const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
  assert.match(source, /api\.applySessionAlias\(candidate.target, alias.trim\(\), candidate.title\)/)
  assert.match(source, /controller.current\?\.abort\(\)/)
  assert.match(source, /if \(!operation.signal.aborted && mounted.current\)/)
  assert.doesNotMatch(source, /api\.(updateChat|renameNative|send|importSession)/)
  assert.match(api, /'\/session-names\/alias', 'POST', \{ target, title, expectedTitle \}/)
})
