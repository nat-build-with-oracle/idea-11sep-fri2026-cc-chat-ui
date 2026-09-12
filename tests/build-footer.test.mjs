import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('build label renders without a backend, browser storage, or a network request', async t => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Build label must not request a backend') }
  t.after(() => { globalThis.fetch = originalFetch })
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => server.close())
  const { default: BuildFooter } = await server.ssrLoadModule('/src/BuildFooter.tsx')
  const html = renderToStaticMarkup(createElement(BuildFooter))
  assert.match(html, /UI v\d+\.\d+\.\d+-alpha\.\d+/)
  assert.match(html, /Build \d{2}:\d{2}:\d{2}\.\d{3} UTC/)
  assert.match(html, /Build ID/)
  assert.match(html, /Frontend only/)
  assert.match(html, /<footer class="[^"]*\bjustify-end\b/)
  assert.match(html, /class="build-details [^"]*\bright-3\b/)
  assert.doesNotMatch(html, /unbuilt/)
})

test('the build footer stays outside backend gating and the collapsible sidebar', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.match(main, /<BackendConnection><App\s*\/><\/BackendConnection><\/div>\s*<BuildFooter\s*\/>/)
})
