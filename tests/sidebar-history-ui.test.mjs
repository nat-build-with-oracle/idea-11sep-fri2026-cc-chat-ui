import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

test('history controls expose load-all, separate one-page loading, stop, and partial completion states', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { default: Controls } = await server.ssrLoadModule('/src/HistoryLoadControls.tsx')
  const options = { hasMore: true, loading: null, pages: 0, notice: '', disabled: false, onMore() {}, onAll() {}, onStop() {} }
  const render = props => renderToStaticMarkup(createElement(Controls, { ...options, ...props }))
  const ready = render()
  assert.match(ready, /Load all remaining/)
  assert.match(ready, /Load more/)
  assert.doesNotMatch(ready, /Stop loading/)
  const loading = render({ loading: 'all', pages: 12, disabled: true })
  assert.match(loading, /12 pages added/)
  assert.match(loading, /role="status"/)
  assert.match(loading, /<button[^>]*>Stop loading<\/button>/)
  assert.doesNotMatch(loading, /disabled|Load all remaining/)
  assert.match(render({ loading: 'page' }), /Loading history…/)
  assert.match(render({ disabled: true }), /disabled=""/)
  assert.equal(render({ hasMore: false }), '')
  assert.match(render({ hasMore: false, notice: 'All available history is loaded.' }), /All available history is loaded/)
  assert.match(render({ notice: 'Loaded 100 pages. More history remains.' }), /Load all remaining/)
  let more = 0, all = 0, stop = 0
  const tree = Controls({ ...options, onMore() { more++ }, onAll() { all++ } })
  const buttons = tree.props.children[0].props.children[0].props.children
  buttons[0].props.onClick(); buttons[1].props.onClick()
  Controls({ ...options, loading: 'all', onStop() { stop++ } }).props.children[0].props.children[1].props.children[1].props.onClick()
  assert.deepEqual({ more, all, stop }, { more: 1, all: 1, stop: 1 })
})

test('sidebar actions have explicit labels and rename does not activate the thread', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { RepositoryActions, SidebarThread } = await server.ssrLoadModule('/src/SidebarActions.tsx')
  const actions = (favorite, threadSort = 'updated') => renderToStaticMarkup(createElement(RepositoryActions, { name: 'black-oracle', favorite, threadSort, onFavorite() {}, onRename() {}, onThreadSort() {}, onHide() {} }))
  assert.match(actions(false), /aria-label="Favorite black-oracle" aria-pressed="false"/)
  assert.match(actions(true), /aria-label="Unfavorite black-oracle" aria-pressed="true"/)
  assert.match(actions(true), /aria-label="Options for black-oracle"/)
  assert.match(actions(true), /Rename display name/)
  assert.match(actions(true), /Hide from sidebar/)
  assert.match(actions(true), /Latest updated/)
  assert.match(actions(true, 'name'), /aria-pressed="true"[^>]*>.*Name A–Z/s)
  let selected = 0, renamed = 0
  const row = SidebarThread({ title: 'hello', selected: true, nested: true, nativeId: 'session-a', onSelect() { selected++ }, onRename() { renamed++ } })
  const markup = renderToStaticMarkup(row)
  assert.match(markup, /aria-label="Rename hello"/)
  assert.match(markup, /title="Rename display name"/)
  assert.match(markup, /data-native-thread="session-a"/)
  assert.match(markup, /aria-current="page"/)
  assert.equal((markup.match(/<button/g) || []).length, 2)
  assert.doesNotMatch(markup, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/)
  row.props.children[1].props.onClick()
  assert.deepEqual({ selected, renamed }, { selected: 0, renamed: 1 })
  row.props.children[0].props.onClick()
  assert.equal(selected, 1)
  const locked = renderToStaticMarkup(createElement(SidebarThread, { title: 'active', selected: false, locked: true, renameDisabled: true, onSelect() {}, onRename() {} }))
  assert.match(locked, /aria-label="Rename active"[^>]*disabled=""/)
  assert.match(locked, /title="Rename unavailable while another change is saving"/)
})

test('App targets sidebar renames by identity and keeps display aliases out of project creation', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(source, /openRename\(\{ kind: 'chat', id: item.id \}, item.title\)/)
  assert.match(source, /openRename\(\{ kind: 'native', id: thread\.item\.sessionId! \}/)
  const saveRename = source.slice(source.indexOf('async function saveRename'), source.indexOf('async function addProject'))
  assert.match(saveRename, /api\.updateChat\(renameTarget.id/)
  assert.match(saveRename, /api\.renameNative\(renameTarget.id/)
  assert.doesNotMatch(saveRename, /api\.updateChat\(chat.id|api\.renameNative\(native.sessionId/)
  const ensureProject = source.slice(source.indexOf('async function ensureProject'), source.indexOf('function showAgents'))
  assert.match(ensureProject, /baseRepositoryRows.find/)
  assert.match(source, /remember\('repository-preferences', serializeRepositoryPreferences\(next\)\)/)
  assert.match(source, /sortRepositoryThreads\(repo\.chats, repo\.sessions, threadSort\)/)
  assert.match(source, /setRepositoryThreadSort\(repositoryPreferences, repo\.path, sort\)/)
  assert.match(source, /setShowJumpToBottom\(true\)/)
  assert.match(source, /className="jump-to-bottom" onClick=\{jumpToBottom\}/)
  assert.match(source, />ARRA Claude Code<\/span>/)
  assert.match(source, /document\.title = `\$\{currentTitle\} — ARRA Claude Code`/)
})
