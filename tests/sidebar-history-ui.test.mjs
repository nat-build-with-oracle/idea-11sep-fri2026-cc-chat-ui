import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

test('sidebar timeline uses native same-tab navigation so browser Back can return', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const navigation = source.slice(source.indexOf('<div className="primary-nav">'), source.indexOf('<nav className="sidebar-scroll">'))
  const link = navigation.match(/<a\b[^>]*href=\{[\s\S]*?<\/a>/)?.[0]
  assert.match(link, /timelineLink\(window.location.href/)
  assert.match(link, /routeHash\(route\)/)
  assert.ok(link, 'Live Timeline must be in the primary sidebar navigation')
  assert.doesNotMatch(link, /target=|opens in a new tab/)
  assert.match(link, /rel="noreferrer"/)
  assert.match(link, /Back button to return/)
  assert.match(link, /<span>Live Timeline<\/span>/)
  assert.match(link, /className="agents-nav no-underline"/)
  assert.doesNotMatch(link, /onClick|onMouseEnter|aria-current|selected/)
})

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

test('sidebar existing-terminal action copies only verified metadata without selecting the thread', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { SidebarThread } = await server.ssrLoadModule('/src/SidebarActions.tsx')
  const existingTerminal = {
    sessionName: 'ampere-token',
    target: 'ampere-token:arra-memory-one-click.0',
    paneId: '%94',
    attachCommand: "maw a 'ampere-token'",
  }
  let selected = 0, copied = 0
  const row = SidebarThread({
    title: 'Ampere agent',
    selected: false,
    existingTerminal,
    onSelect() { selected++ },
    onCopyExistingTerminal() { copied++ },
  })
  const markup = renderToStaticMarkup(row)
  assert.match(markup, /aria-label="Copy existing terminal for Ampere agent"/)
  assert.match(markup, /title="Copy existing terminal · ampere-token:arra-memory-one-click\.0"/)
  assert.equal((markup.match(/<button/g) || []).length, 2)
  row.props.children.find(child => child?.props?.className?.includes('existing-terminal-action')).props.onClick()
  assert.deepEqual({ selected, copied }, { selected: 0, copied: 1 })

  const unmatched = renderToStaticMarkup(createElement(SidebarThread, { title: 'Standalone WezTerm', selected: false, onSelect() {} }))
  assert.doesNotMatch(unmatched, /Copy existing terminal/)
  assert.equal((unmatched.match(/<button/g) || []).length, 1)
})

test('fresh existing-terminal lookup returns only exact current mappings and propagates refresh failures', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { loadFreshExistingTerminal } = await server.ssrLoadModule('/src/SidebarActions.tsx')
  const guardedAttach = "if tmux has-session -t '=ampere-token' 2>/dev/null; then maw a 'ampere-token'; else printf '%s\\n' 'Terminal closed.' >&2; false; fi"
  const active = { sessionId: 'active-id', existingTerminal: { sessionName: 'ampere-token', target: 'ampere-token:0.1', paneId: '%94', attachCommand: guardedAttach } }
  const saved = { sessionId: 'saved-id' }

  const fresh = await loadFreshExistingTerminal('active-id', async () => ({ sessions: [active, saved] }))
  assert.deepEqual(fresh.sessions, [active, saved])
  assert.equal(fresh.existingTerminal.attachCommand, guardedAttach)

  const exited = await loadFreshExistingTerminal('active-id', async () => ({ sessions: [saved] }))
  assert.deepEqual(exited.sessions, [saved])
  assert.equal(exited.existingTerminal, undefined)

  let copied = false
  await assert.rejects(
    loadFreshExistingTerminal('active-id', async () => { throw new Error('refresh unavailable') })
      .then(() => { copied = true }),
    /refresh unavailable/,
  )
  assert.equal(copied, false)
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
  assert.match(source, /remember\('repository-preferences', serialized\)/)
  assert.match(source, /api\.saveRepositoryPreferences\(JSON\.parse\(serialized\)\)/)
  assert.match(source, /sortRepositoryThreads\(repo\.chats, repo\.sessions, threadSort\)/)
  assert.match(source, /setRepositoryThreadSort\(repositoryPreferences, repo\.path, sort\)/)
  assert.match(source, /setShowJumpToBottom\(true\)/)
  assert.match(source, /className="jump-to-bottom" onClick=\{jumpToBottom\}/)
  assert.match(source, />ARRA Claude Code<\/span>/)
  assert.match(source, /document\.title = `\$\{currentTitle\} — ARRA Claude Code`/)
  assert.match(source, /existingTerminalFor\(thread\.item\.sessionId\)/)
  assert.match(source, /existingTerminal=\{thread\.item\.readOnlyReason \? undefined : thread\.item\.existingTerminal\}/)
  assert.match(source, /existingTerminalFor\(item\.sessionId\)/)
  assert.match(source, /copy\(fresh\.existingTerminal\.attachCommand, `Existing terminal copied/)
  assert.match(source, /currentExistingTerminal && currentSessionId \? <button[\s\S]*?Copy existing terminal/)
  const selectedTerminal = source.slice(source.indexOf('const currentSessionId'), source.indexOf('const currentTitle'))
  assert.match(selectedTerminal, /nativeSessions\.find\(item => item\.sessionId === currentSessionId\)\?\.existingTerminal/)
  assert.doesNotMatch(selectedTerminal, /currentNativeSession\?\.existingTerminal|\?\? native/)
  const refreshedCopy = source.slice(source.indexOf('async function copyExistingTerminal'), source.indexOf('function existingTerminalFor'))
  assert.match(refreshedCopy, /loadFreshExistingTerminal\(sessionId, api\.nativeSessions\)/)
  assert.ok(refreshedCopy.indexOf('requestId !== nativeListRequest.current') < refreshedCopy.indexOf('setNativeSessions(fresh.sessions)'))
  assert.ok(refreshedCopy.indexOf('setNativeSessions(fresh.sessions)') < refreshedCopy.indexOf('copy(fresh.existingTerminal.attachCommand'))
  assert.match(refreshedCopy, /No existing maw terminal is available/)
  assert.doesNotMatch(refreshedCopy, /terminalCommand|resumeCommand|tmuxResumeCommand/)
  const quietRefresh = source.slice(source.indexOf('async function refreshNativeQuiet'), source.indexOf('async function ensureProject'))
  assert.match(source, /startNativeSessionRefresh\(\{ refresh: refreshNativeQuiet \}\)/)
  assert.match(quietRefresh, /if \(preview \|\| nativeForegroundRefreshes\.current\) return/)
  assert.match(quietRefresh, /requestId === nativeListRequest\.current/)
  // The quiet poll stays quiet. Following an open session's new messages lives in its
  // own effect, keyed on the updatedAt this poll refreshes, so the poll itself never
  // mutates the message list.
  const followOpen = source.slice(source.indexOf('const openNativeUpdatedAt'), source.indexOf('useEffect(() => { document.title'))
  assert.match(followOpen, /openNativeUpdatedAt <= nativeSyncedAt\.current/)
  assert.match(followOpen, /api\.nativeHistory\(nativeRouteId\)/)
  assert.match(followOpen, /historyRequest\.current\) return/)
  // Merge, never replace: a reader who paged back through older history must not have
  // it discarded by a refetch that only asked for the newest page.
  assert.match(followOpen, /mergeHistoryMessages\(previous, page\.messages\)/)
  assert.doesNotMatch(followOpen, /setNativeMessages\(page\.messages\)/)
  assert.doesNotMatch(quietRefresh, /setNativeListLoading|setNativeError|navigate|setDraft|setNativeMessages/)
  assert.match(source, /kind === 'attach' && currentSessionId \? void copyExistingTerminal\(currentSessionId\)/)
})
