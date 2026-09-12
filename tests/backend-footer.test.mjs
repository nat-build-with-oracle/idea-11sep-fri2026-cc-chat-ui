import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

async function loadFooter(t) {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  return (await server.ssrLoadModule('/src/BackendConnectionInfo.tsx')).default
}

test('sidebar footer visibly links the selected backend origin', async t => {
  const Footer = await loadFooter(t)
  const render = href => renderToStaticMarkup(createElement(Footer, { connected: true, href, preview: false, settings: null }))

  const defaultHtml = render('https://chat.example.workers.dev/')
  assert.match(defaultHtml, />Backend <span>http:\/\/127\.0\.0\.1:4318<\/span>/)
  assert.match(defaultHtml, /href="http:\/\/127\.0\.0\.1:4318"/)
  assert.match(defaultHtml, /Local on this Mac/)
  assert.match(defaultHtml, /Conversations stay on your chosen backend/)

  const selectedHtml = render('https://chat.example.workers.dev/?host=https%3A%2F%2Fbackend.example')
  assert.match(selectedHtml, />Backend <span>https:\/\/backend\.example<\/span>/)
  assert.match(selectedHtml, /href="https:\/\/backend\.example"/)
  assert.doesNotMatch(selectedHtml, /127\.0\.0\.1:4318/)
})

test('preview footer identifies the design preview without pretending it is connected', async t => {
  const Footer = await loadFooter(t)
  const html = renderToStaticMarkup(createElement(Footer, { connected: true, href: 'https://chat.example.workers.dev/?preview=oracle', preview: true, settings: null }))

  assert.match(html, /Design preview/)
  assert.match(html, />Backend <span>http:\/\/127\.0\.0\.1:4318<\/span>/)
  assert.doesNotMatch(html, /Local on this Mac|Backend connected/)
})
