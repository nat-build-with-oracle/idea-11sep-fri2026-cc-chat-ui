import { Icon } from './Icon'
import ToolPayload from './ToolPayload'
import { formatToolInput, formatToolResult } from './tool-format'
import { activitySummary, type ActivityTool, type ConversationActivityItem } from './activity-model'

export { activitySummary } from './activity-model'

function basename(value: string) {
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || value
}

function detailFor(tool: ActivityTool) {
  if (!tool.input || typeof tool.input !== 'object') return ''
  const input = tool.input as Record<string, unknown>
  const file = [input.file_path, input.path].find(value => typeof value === 'string')
  if (typeof file === 'string') return basename(file)
  const detail = [input.description, input.pattern, input.to, input.command].find(value => typeof value === 'string')
  if (typeof detail !== 'string') return ''
  const firstLine = detail.split('\n', 1)[0]
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine
}

function ActivityRow({ tool }: { tool: ActivityTool }) {
  const detail = detailFor(tool)
  const error = Boolean(tool.result?.isError)
  const input = formatToolInput(tool.name, tool.input)
  return <div className={`tool-activity-row${error ? ' tool-result-error' : ''}`}>
    <div className="tool-activity-row-heading">
      <span className="tool-kind-icon"><Icon name={tool.name === 'Bash' ? 'terminal' : 'file'} size={17} /></span>
      <span className="tool-heading-text"><strong>{tool.name}</strong>{detail && <span className="truncate" title={detail}>{detail}</span>}</span>
      <span className={`tool-state ${error ? 'tool-state-error' : ''}`}>{error ? <><Icon name="info" size={13} />Error</> : tool.status === 'running' ? <><span className="activity-dot" />Running</> : <><Icon name="check" size={13} />Done</>}</span>
    </div>
    {!tool.resultOnly && <ToolPayload label={input.label} value={input} />}
    {tool.result && <ToolPayload label={error ? 'Error output' : 'Output'} value={formatToolResult(tool.result.content)} error={error} />}
    {!tool.result && <p className="tool-output-note">{tool.status === 'running' ? 'Waiting for output…' : 'No output in the loaded history.'}</p>}
    {tool.resultOnly && <small>Tool call details are not available in the loaded history.</small>}
  </div>
}

export function Activity({ item }: { item: ConversationActivityItem }) {
  const running = item.tools.some(tool => tool.status === 'running')
  const summary = activitySummary(item.tools)
  const errors = item.tools.filter(tool => tool.result?.isError).length
  const recentTool = running ? [...item.tools].reverse().find(tool => tool.status === 'running') ?? item.tools[item.tools.length - 1] : undefined
  const recentDetail = recentTool ? detailFor(recentTool) : ''
  return <details className="tool-activity activity-group">
    <summary>
      <Icon name={running ? 'terminal' : errors ? 'info' : 'check'} size={16} />
      <span>{running ? 'Working' : 'Activity'}{summary ? ` · ${summary}` : ''}</span>
      {recentDetail && <span className="truncate" title={recentDetail}>{recentDetail}</span>}
      {errors > 0 && <span className="activity-errors">{errors} {errors === 1 ? 'error' : 'errors'}</span>}
      {running && <span className="activity-dot" aria-label="Running" />}
    </summary>
    <div className="tool-activity-list">{item.tools.map((tool, index) => <ActivityRow tool={tool} key={`${tool.id}:${index}`} />)}</div>
  </details>
}

export default Activity
