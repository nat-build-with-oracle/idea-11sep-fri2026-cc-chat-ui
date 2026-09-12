import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('session identity displays and copies the exact Claude ID, not a chat route ID', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { default: Identity } = await server.ssrLoadModule('/src/SessionIdentity.tsx')
  const id = '45ef6e5f-c1ce-4b33-aa01-28db3eaa6574'
  let copied = null
  const props = { sessionId: id, onCopy: value => { copied = value } }
  const html = renderToStaticMarkup(createElement(Identity, props))
  assert.match(html, new RegExp(`<code>${id}</code>`))
  assert.match(html, new RegExp(`aria-label="Copy Claude session ID ${id}"`))
  Identity(props).props.onClick()
  assert.equal(copied, id)
  assert.equal(Identity({ ...props, sessionId: null }), null)
})
