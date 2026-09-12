import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('connection help explains real browser permission without pretending to grant it', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { default: ConnectionHelp } = await server.ssrLoadModule('/src/ConnectionHelp.tsx')
  const render = (props = {}) => renderToStaticMarkup(createElement(ConnectionHelp, {
    origin: 'http://127.0.0.1:4318', frontendOrigin: 'https://chat.example', local: true, issue: 'Failed to fetch', checking: false,
    onRetry: () => {}, onClose: () => {}, ...props,
  }))
  const local = render()
  assert.match(local, /other apps and services on this device/)
  assert.match(local, /Comet/)
  assert.match(local, /ERR_BLOCKED_BY_CLIENT/)
  assert.match(local, /Settings → Privacy → Blocking/)
  assert.match(local, /Adblock exceptions/)
  assert.match(local, /https:\/\/chat\.example/)
  assert.match(local, /keep global blocking enabled/)
  assert.match(local, /Site settings/)
  assert.match(local, /if available/)
  assert.match(local, /cannot grant this permission/)
  assert.match(local, /run Claude commands/)
  assert.match(local, /Retry connection/)
  assert.match(local, /never resends a message/)
  assert.match(local, /href="http:\/\/127\.0\.0\.1:4318\/"/)
  assert.match(render({ checking: true }), /disabled=""[^>]*>Checking/)
  const remote = render({ origin: 'https://backend.example', local: false })
  assert.doesNotMatch(remote, /other apps and services on this device|Open local app/)
  assert.match(remote, /HTTPS/)
  assert.match(remote, /CORS/)
  assert.doesNotMatch(render({ issue: '<img src=x onerror=alert(1)>' }), /<img/)
})
