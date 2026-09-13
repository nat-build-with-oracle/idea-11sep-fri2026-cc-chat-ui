import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

test('model picker offers only Claude Sonnet, Opus, and Haiku without provider routing', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => vite.close())
  const { default: Picker } = await vite.ssrLoadModule('/src/ModelPicker.tsx')
  let choice
  const props = { model: 'sonnet', disabled: false, onChange: model => { choice = model } }
  const markup = renderToStaticMarkup(createElement(Picker, props))
  assert.match(markup, /value="sonnet"[^>]*>Claude Sonnet/)
  assert.match(markup, /value="opus"[^>]*>Claude Opus/)
  assert.match(markup, /value="haiku"[^>]*>Claude Haiku/)
  assert.doesNotMatch(markup, /GLM|Z\.AI|provider|optgroup/i)
  assert.equal((markup.match(/<option/g) || []).length, 3)
  const tree = Picker(props)
  tree.props.children[0].props.onChange({ target: { value: 'opus' } })
  assert.equal(choice, 'opus')
})

test('frontend chat writes do not send or patch provider fields', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(app, /health\?\.providers|setProvider\(|provider:\s*nextProvider/)
  assert.doesNotMatch(api, /Pick<Chat,[^>]*'provider'/)
  assert.match(app, /api\.createChat\(\{[^}]*model,[^}]*permissionMode: permission/s)
})
