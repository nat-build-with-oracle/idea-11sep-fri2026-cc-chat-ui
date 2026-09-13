import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

test('only supported Claude chats are writable; legacy records get a read-only explanation', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  t.after(() => vite.close())
  const { chatReadOnlyReason, isWritableClaudeChat } = await vite.ssrLoadModule('/src/claude-chat.ts')

  for (const model of ['sonnet', 'opus', 'haiku']) {
    assert.equal(isWritableClaudeChat({ model }), true)
    assert.equal(isWritableClaudeChat({ provider: 'claude', model }), true)
  }
  for (const provider of ['zai', '', null]) {
    assert.equal(isWritableClaudeChat({ provider, model: 'sonnet' }), false)
    assert.match(chatReadOnlyReason({ provider, model: 'sonnet' }), /removed provider/i)
  }
  assert.equal(isWritableClaudeChat({ model: 'glm-5.3' }), false)
  assert.equal(isWritableClaudeChat({ provider: 'claude', model: 'future-model' }), false)
  assert.match(chatReadOnlyReason({ provider: 'zai', model: 'glm-5.3' }), /removed provider/i)
  assert.match(chatReadOnlyReason({ model: 'glm-5.2' }), /removed provider/i)
  assert.match(chatReadOnlyReason({ provider: 'claude', model: 'future-model' }), /unsupported stored model/i)
  assert.equal(chatReadOnlyReason({ provider: 'claude', model: 'opus' }), '')
})
