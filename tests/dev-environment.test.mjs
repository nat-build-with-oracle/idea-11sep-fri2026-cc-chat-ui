import assert from 'node:assert/strict'
import test from 'node:test'
import { createDevEnvironments } from '../scripts/dev-environment.mjs'

test('dev credentials are available only to the backend process', () => {
  const secretNames = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_CUSTOM_SECRET',
    'ZAI_API_KEY',
    'Z_AI_API_KEY',
    'CC_CHAT_CHAT_MODELS',
    'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'API_TIMEOUT_MS',
  ]
  const sourceEnv = {
    PATH: '/test/bin',
    HOME: '/test/home',
    VITE_PUBLIC_MARKER: 'visible',
    DEV_ORIGIN: 'http://old-origin.test',
    ...Object.fromEntries(secretNames.map((name) => [name, `secret-${name}`])),
  }

  const { backendEnv, clientEnv } = createDevEnvironments(sourceEnv)

  for (const name of secretNames) {
    assert.equal(backendEnv[name], ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'].includes(name) ? sourceEnv[name] : undefined)
    assert.equal(name in clientEnv, false)
  }
  assert.equal(backendEnv.ANTHROPIC_BASE_URL, 'https://api.anthropic.com')
  assert.equal(backendEnv.DEV_ORIGIN, 'http://127.0.0.1:5173')
  assert.deepEqual(clientEnv, {
    PATH: '/test/bin',
    HOME: '/test/home',
    VITE_PUBLIC_MARKER: 'visible',
    DEV_ORIGIN: 'http://old-origin.test',
  })
})
