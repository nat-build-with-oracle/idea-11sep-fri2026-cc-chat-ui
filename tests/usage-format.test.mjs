import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatTokenCount,
  formatUsageSummary,
  formatUsdCost,
  totalInputTokens,
  usageScopeNote,
} from '../src/usage-format.ts'

test('input total includes uncached, cache-read, and cache-write tokens', () => {
  const usage = {
    inputTokens: 1_234,
    outputTokens: 56,
    cacheReadInputTokens: 7_000,
    cacheCreationInputTokens: 89,
  }
  assert.equal(totalInputTokens(usage), 8_323)
  assert.equal(formatUsageSummary(usage, 'en-US'), '8,323 tokens in · 56 tokens out')
})

test('zero values are real values while absent optional fields are not guessed', () => {
  assert.equal(totalInputTokens({ inputTokens: 0, outputTokens: 0 }), 0)
  assert.equal(
    formatUsageSummary({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 }, 'en-US'),
    '0 tokens in · 0 tokens out',
  )
  assert.doesNotMatch(formatUsageSummary({ inputTokens: 2, outputTokens: 1 }, 'en-US'), /\$/)
})

test('counts are exact and localized rather than compact approximations', () => {
  assert.equal(formatTokenCount(1_234_567, 'en-US'), '1,234,567')
})

test('reported cost keeps meaningful precision for tiny nonzero amounts', () => {
  assert.equal(formatUsdCost(0.0000042, 'en-US'), '$0.0000042')
  assert.equal(formatUsageSummary({ inputTokens: 2, outputTokens: 1, costUsd: 0.0000042 }, 'en-US'), '2 tokens in · 1 token out · $0.0000042')
  assert.notEqual(formatUsdCost(0.0000042, 'en-US'), '$0.00')
})

test('scope notes distinguish all-model accounting, older main-agent fallback, and history API messages', () => {
  const base = { inputTokens: 2, outputTokens: 1 }
  assert.match(usageScopeNote({ ...base, scope: 'allModels' }), /across all models/)
  assert.match(usageScopeNote({ ...base, scope: 'mainAgent' }), /subagents and auxiliary calls are excluded/)
  assert.match(usageScopeNote({ ...base, scope: 'apiMessage' }), /this API response/)
  assert.equal(usageScopeNote(base), 'Reported API usage, not context-window size.')
})
