import { createClaudeEnvironment } from '../server/claude-environment.mjs'

const CLIENT_BLOCKED_ENV_NAMES = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ZAI_API_KEY',
  'Z_AI_API_KEY',
  'CC_CHAT_CHAT_MODELS',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'API_TIMEOUT_MS',
])

export function createDevEnvironments(sourceEnv = process.env) {
  const clientEnv = Object.fromEntries(
    Object.entries(sourceEnv).filter(([name]) => (
      !name.startsWith('ANTHROPIC_') && !CLIENT_BLOCKED_ENV_NAMES.has(name)
    )),
  )

  return {
    backendEnv: { ...createClaudeEnvironment(sourceEnv), DEV_ORIGIN: 'http://127.0.0.1:5173' },
    clientEnv,
  }
}
