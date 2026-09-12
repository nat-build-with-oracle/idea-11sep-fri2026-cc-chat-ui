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
  tree.props.onClick()
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
