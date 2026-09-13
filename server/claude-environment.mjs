const ANTHROPIC_URL = 'https://api.anthropic.com';
const AUTH_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
const REMOVED_OVERRIDES = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN', 'CC_CHAT_CHAT_MODELS', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'API_TIMEOUT_MS',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
]);

// Keep the normal Claude login (HOME/keychain/config) and official credentials.
// Never reuse tokens or model mappings from the removed third-party endpoint.
export function createClaudeEnvironment(source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) =>
    !/^(ANTHROPIC_|ZAI_|Z_AI_)/.test(key) && !REMOVED_OVERRIDES.has(key)));
  const official = !source.ANTHROPIC_BASE_URL || source.ANTHROPIC_BASE_URL.replace(/\/$/, '') === ANTHROPIC_URL;
  if (official) {
    for (const key of AUTH_KEYS) if (source[key]) env[key] = source[key];
  }
  return { ...env, ANTHROPIC_BASE_URL: ANTHROPIC_URL };
}
