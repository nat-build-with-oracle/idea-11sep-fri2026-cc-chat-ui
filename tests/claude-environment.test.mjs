import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeEnvironment } from '../server/claude-environment.mjs';

test('Claude environment preserves official auth and normal login location, not removed model mappings', () => {
  const source = { PATH: '/bin', HOME: '/home/user', CLAUDE_CONFIG_DIR: '/home/user/.claude', ZAI_API_KEY: 'dummy-zai', ANTHROPIC_API_KEY: 'dummy-claude', ANTHROPIC_AUTH_TOKEN: 'dummy-auth', CLAUDE_CODE_OAUTH_TOKEN: 'dummy-oauth', ANTHROPIC_DEFAULT_OPUS_MODEL: 'foreign', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' };
  const before = { ...source };
  assert.deepEqual(createClaudeEnvironment(source), {
    PATH: '/bin', HOME: '/home/user', CLAUDE_CONFIG_DIR: '/home/user/.claude',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_API_KEY: 'dummy-claude',
    ANTHROPIC_AUTH_TOKEN: 'dummy-auth', CLAUDE_CODE_OAUTH_TOKEN: 'dummy-oauth',
  });
  assert.deepEqual(source, before);
});

test('third-party credentials and routing cannot cross back into Claude', () => {
  for (const endpoint of ['https://api.z.ai/api/anthropic', 'https://foreign.example']) {
    const env = createClaudeEnvironment({
      PATH: '/bin', ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: 'dummy-foreign',
      ANTHROPIC_API_KEY: 'dummy-key', CLAUDE_CODE_OAUTH_TOKEN: 'dummy-oauth',
      Z_AI_API_KEY: 'dummy-key', CC_CHAT_CHAT_MODELS: 'glm-5.2',
      ANTHROPIC_MODEL: 'glm-5.2', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.2',
      CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1',
    });
    assert.deepEqual(env, { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' });
  }
});

test('official endpoint with trailing slash keeps the existing credential', () => {
  assert.equal(createClaudeEnvironment({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com/', ANTHROPIC_API_KEY: 'dummy' }).ANTHROPIC_API_KEY, 'dummy');
});
