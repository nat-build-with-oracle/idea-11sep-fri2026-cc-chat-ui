import type { Usage } from './types'

const tokenFormatters = new Map<string, Intl.NumberFormat>()
const costFormatters = new Map<string, Intl.NumberFormat>()

function localeKey(locale?: string) {
  return locale || 'default'
}

export function formatTokenCount(value: number, locale?: string) {
  const key = localeKey(locale)
  let formatter = tokenFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
    tokenFormatters.set(key, formatter)
  }
  return formatter.format(value)
}

export function formatUsdCost(value: number, locale?: string) {
  const key = localeKey(locale)
  let formatter = costFormatters.get(key)
  if (!formatter) {
    // Significant digits retain genuinely small reported costs instead of
    // rounding them to a misleading "$0.00".
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumSignificantDigits: 1,
      maximumSignificantDigits: 6,
    })
    costFormatters.set(key, formatter)
  }
  return formatter.format(value)
}

export function totalInputTokens(usage: Usage) {
  return usage.inputTokens
    + (usage.cacheReadInputTokens ?? 0)
    + (usage.cacheCreationInputTokens ?? 0)
}

export function formatUsageSummary(usage: Usage, locale?: string) {
  const input = totalInputTokens(usage)
  const parts = [
    `${formatTokenCount(input, locale)} ${input === 1 ? 'token' : 'tokens'} in`,
    `${formatTokenCount(usage.outputTokens, locale)} ${usage.outputTokens === 1 ? 'token' : 'tokens'} out`,
  ]
  if (usage.costUsd !== undefined) parts.push(formatUsdCost(usage.costUsd, locale))
  return parts.join(' · ')
}

export function usageScopeNote(usage: Usage) {
  if (usage.scope === 'allModels') return 'Reported API usage across all models, not context-window size.'
  if (usage.scope === 'mainAgent') return 'Main-agent API usage only; subagents and auxiliary calls are excluded. Not context-window size.'
  if (usage.scope === 'apiMessage') return 'Reported usage for this API response, not context-window size.'
  return 'Reported API usage, not context-window size.'
}
