import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parseAppearance, themeColorFor, themes } from '../src/appearance-settings.ts'
test('new and malformed appearance settings use readable Pop defaults', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{"theme":"unknown","textSize":"tiny"}']) assert.deepEqual(parseAppearance(raw), {theme:'pop',textSize:'comfortable'})
})
test('all themes and larger text can be persisted and restored', () => {
  for (const theme of themes) assert.deepEqual(parseAppearance(JSON.stringify({theme,textSize:'large'})),{theme,textSize:'large'})
})

test('each theme maps to the browser chrome color of its canvas', () => {
  assert.deepEqual(themes.map(themeColorFor), ['#f5f5fc', '#f8fafc', '#171923'])
})

async function runBootstrap(stored) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const script = html.match(/<script data-appearance-bootstrap>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script, 'appearance bootstrap script is present')
  const dataset = {}
  const meta = { content: '#unset', setAttribute(name, value) { if (name === 'content') this.content = value } }
  vm.runInNewContext(script, {
    document: { documentElement: { dataset }, querySelector: () => meta },
    localStorage: { getItem: () => stored },
  })
  return { dataset, themeColor: meta.content }
}

test('stored appearance is applied in the document head before React starts', async () => {
  for (const theme of themes) {
    assert.deepEqual(await runBootstrap(JSON.stringify({ theme, textSize: 'large' })), {
      dataset: { theme, textSize: 'large' },
      themeColor: themeColorFor(theme),
    })
  }
})

test('document bootstrap validates malformed appearance values', async () => {
  assert.deepEqual(await runBootstrap('{"theme":"unknown","textSize":"tiny"}'), {
    dataset: { theme: 'pop', textSize: 'comfortable' },
    themeColor: '#f5f5fc',
  })
})
