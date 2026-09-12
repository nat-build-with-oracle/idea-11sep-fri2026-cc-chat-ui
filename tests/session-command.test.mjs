import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

async function loadCommand(t) {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  return server.ssrLoadModule('/src/SessionCommand.tsx')
}

test('resume command copies the exact visible CLI without executing it', async t => {
  const { default: SessionCommand, resumeCommand } = await loadCommand(t)
  const expected = "cd '/Users/beta/My Repo' && claude --resume 'session-full-id'"
  assert.equal(resumeCommand('session-full-id', '/Users/beta/My Repo'), expected)

  let copied = ''
  const tree = SessionCommand({ sessionId: 'session-full-id', cwd: '/Users/beta/My Repo', onCopy(command) { copied = command } })
  tree.props.children[0].props.onClick()
  assert.equal(copied, expected)

  const html = renderToStaticMarkup(createElement(SessionCommand, { sessionId: 'session-full-id', cwd: '/Users/beta/My Repo', onCopy() {} }))
  assert.match(html, /<code>cd &#x27;\/Users\/beta\/My Repo&#x27; &amp;&amp; claude --resume &#x27;session-full-id&#x27;<\/code>/)
  assert.match(html, /aria-label="Copy resume command:/)
  assert.match(html, /title="cd/)
})

test('shell quoting preserves apostrophes and cwd is optional', async t => {
  const { resumeCommand } = await loadCommand(t)
  assert.equal(
    resumeCommand("session'id", "/Users/O'Brien's Repo"),
    "cd '/Users/O'\\''Brien'\\''s Repo' && claude --resume 'session'\\''id'",
  )
  assert.equal(resumeCommand('session-id'), "claude --resume 'session-id'")
})

test('missing session IDs render no command or placeholder', async t => {
  const { default: SessionCommand } = await loadCommand(t)
  assert.equal(renderToStaticMarkup(createElement(SessionCommand, { sessionId: null, cwd: '/repo', onCopy() {} })), '')
})

test('the adjacent tmux button copies a named session launcher without replacing the resume command', async t => {
  const { default: SessionCommand } = await loadCommand(t)
  let copied
  const props = { sessionId: 'native-id', cwd: '/repos/neo-oracle', title: 'arra memory one click', onCopy: (...args) => { copied = args } }
  const tree = SessionCommand(props)
  const html = renderToStaticMarkup(tree)
  assert.match(html, /Copy tmux/)
  assert.match(html, /Copy tmux command for neo-oracle-arra-memory-one-click/)
  assert.equal((html.match(/<button/g) || []).length, 9)
  tree.props.children[1].props.onClick()
  assert.equal(copied[1], 'tmux')
  assert.match(copied[0], /tmux new-session/)
  assert.match(copied[0], /maw a/)
  tree.props.children[0].props.onClick()
  assert.deepEqual(copied, ["cd '/repos/neo-oracle' && claude --resume 'native-id'", 'resume'])
})

test('one-shot test copies an explicit prompt and preserves the current native session and cwd', async t => {
  const { default: SessionCommand, oneShotCommand } = await loadCommand(t)
  const id = 'cc08ff60-ab16-41ea-bac6-f3e96ea2d992'
  const expected = `cd '/repos/neo-oracle' && claude --resume '${id}' -p 'Reply with exactly: ARRA sync test OK. Do not use tools or modify files.' --tools ''`
  assert.equal(oneShotCommand(id, '/repos/neo-oracle'), expected)
  let copied
  const tree = SessionCommand({ sessionId: id, cwd: '/repos/neo-oracle', onCopy: (...args) => { copied = args } })
  tree.props.children[2].props.onClick()
  assert.deepEqual(copied, [expected, 'oneshot'])
  assert.match(renderToStaticMarkup(tree), /Running uses Claude quota and appends a test turn/)
  assert.doesNotMatch(expected, /no-session-persistence|fork-session|dangerously-skip-permissions/)
})

test('collapsed disclosure contains complete selectable commands and each copy matches its text', async t => {
  const { default: SessionCommand, resumeCommand, oneShotCommand } = await loadCommand(t)
  const copied = []
  const tree = SessionCommand({ sessionId: 'exact-id', cwd: '/repos/neo-oracle', title: 'Memory test', onCopy: (...args) => copied.push(args) })
  const disclosure = tree.props.children.find(child => child?.type === 'details')
  assert.equal(disclosure.props.open, undefined)
  const cards = disclosure.props.children[1].props.children[1]
  assert.equal(cards.length, 6)
  for (const card of cards) {
    const displayed = card.props.children[1].props.children.props.children
    card.props.children[0].props.children[1].props.onClick()
    assert.equal(copied.at(-1)[0], displayed)
  }
  assert.deepEqual(copied.map(([, kind]) => kind), ['resume', 'tmux', 'oneshot', 'resume', 'tmux', 'oneshot'])
  assert.equal(copied[0][0], resumeCommand('exact-id', '/repos/neo-oracle'))
  assert.equal(copied[2][0], oneShotCommand('exact-id', '/repos/neo-oracle'))
  const html = renderToStaticMarkup(tree)
  assert.match(html, /Show all commands/)
  assert.match(html, /Full session commands/)
  assert.match(html, /Copy only—nothing runs here/)
  assert.equal((html.match(/<pre><code>/g) || []).length, 6)
})

test('verified existing terminal copies the backend attach command exactly without changing launch commands', async t => {
  const { default: SessionCommand, resumeCommand } = await loadCommand(t)
  const guardedAttach = "if tmux has-session -t '=ampere-token' 2>/dev/null; then maw a 'ampere-token'; else printf '%s\\n' 'Terminal closed.' >&2; false; fi"
  const existingTerminal = {
    sessionName: 'ampere-token',
    target: 'ampere-token:arra-memory-one-click.0',
    paneId: '%94',
    attachCommand: guardedAttach,
  }
  const copied = []
  const tree = SessionCommand({
    sessionId: 'native-id',
    cwd: '/repos/neo-oracle',
    title: 'arra memory one click',
    existingTerminal,
    onCopy: (...args) => copied.push(args),
  })
  const attachButton = tree.props.children.find(child => child?.props?.className?.includes('existing-terminal-command'))
  attachButton.props.onClick()
  assert.deepEqual(copied.at(-1), [guardedAttach, 'attach'])

  const cards = tree.props.children.find(child => child?.type === 'details').props.children[1].props.children[1]
  assert.equal(cards.length, 7)
  assert.equal(cards[0].props.children[1].props.children.props.children, guardedAttach)
  cards[0].props.children[0].props.children[1].props.onClick()
  assert.deepEqual(copied.at(-1), [guardedAttach, 'attach'])
  assert.equal(cards[1].props.children[1].props.children.props.children, resumeCommand('native-id', '/repos/neo-oracle'))

  const html = renderToStaticMarkup(tree)
  assert.match(html, /Copy existing terminal/)
  assert.match(html, /Existing terminal · ampere-token · ampere-token:arra-memory-one-click\.0/)
  assert.match(html, /New tmux · neo-oracle-arra-memory-one-click/)
  assert.match(html, /Existing terminal attach is safe while its owner is open/)
  assert.match(html, /Before running resume, new tmux, or one-shot commands, finish any existing Claude writer/)
  assert.doesNotMatch(existingTerminal.attachCommand, /arra-memory-one-click|%94/)
})

test('full-access variants opt in to permission bypass without changing standard commands', async t => {
  const { default: SessionCommand, resumeCommand, oneShotCommand } = await loadCommand(t)
  const id = "session'quoted"
  const cwd = "/Users/O'Brien/neo-oracle"
  assert.equal(resumeCommand(id, cwd, true), `${resumeCommand(id, cwd)} --dangerously-skip-permissions`)
  assert.doesNotMatch(resumeCommand(id, cwd), /dangerously/)
  assert.match(oneShotCommand(id, cwd, true), /--dangerously-skip-permissions -p /)
  assert.match(oneShotCommand(id, cwd, true), /--tools ''$/)
  const copied = []
  const tree = SessionCommand({ sessionId: id, cwd, title: 'Memory', onCopy: (...args) => copied.push(args) })
  const cards = tree.props.children.find(child => child?.type === 'details').props.children[1].props.children[1]
  const dangerous = cards.filter(card => card.props.className.includes('dangerous'))
  assert.equal(dangerous.length, 3)
  for (const card of dangerous) {
    card.props.children[0].props.children[1].props.onClick()
    assert.equal(copied.at(-1)[0], card.props.children[1].props.children.props.children)
    assert.equal((copied.at(-1)[0].match(/--dangerously-skip-permissions/g) || []).length, 1)
  }
  assert.match(renderToStaticMarkup(tree), /Full access bypasses permission checks/)
  assert.match(renderToStaticMarkup(tree), /Full access · One-shot sync test \(tools off\)/)
})
