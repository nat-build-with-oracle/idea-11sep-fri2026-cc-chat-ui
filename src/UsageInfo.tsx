import type { Usage } from './types'
import { formatTokenCount, formatUsageSummary, formatUsdCost, usageScopeNote } from './usage-format'

export function UsageInfo({ usage }: { usage: Usage }) {
  return <details className="token-usage">
    <summary>{formatUsageSummary(usage)}</summary>
    <div className="usage-breakdown">
      <dl>
        <div><dt>Uncached input</dt><dd>{formatTokenCount(usage.inputTokens)}</dd></div>
        {usage.cacheReadInputTokens !== undefined && <div><dt>Cache read</dt><dd>{formatTokenCount(usage.cacheReadInputTokens)}</dd></div>}
        {usage.cacheCreationInputTokens !== undefined && <div><dt>Cache write</dt><dd>{formatTokenCount(usage.cacheCreationInputTokens)}</dd></div>}
        <div><dt>Output</dt><dd>{formatTokenCount(usage.outputTokens)}</dd></div>
        {usage.costUsd !== undefined && <div><dt>Estimated cost</dt><dd>{formatUsdCost(usage.costUsd)}</dd></div>}
      </dl>
      <p>{usageScopeNote(usage)}</p>
    </div>
  </details>
}

export default UsageInfo
