import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { highlightShell } from './tool-format'

type Payload = { language: 'shell' | 'json' | 'text'; content: string; raw: string; hasRaw: boolean }

export default function ToolPayload({ label, value, error = false }: { label: string; value: Payload; error?: boolean }) {
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const content = raw ? value.raw : value.content
  const lines = content ? content.split('\n').length : 0
  const shell = !raw && value.language === 'shell'

  async function copy() {
    try { await navigator.clipboard.writeText(content); setCopied('copied') }
    catch { setCopied('failed') }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied('idle'), 1800)
  }

  return <section className={`tool-payload ${shell ? 'tool-command' : 'tool-output'}${error ? ' payload-error' : ''}`} aria-label={`${label} panel`}>
    <div className="tool-payload-toolbar">
      <span className="tool-payload-label"><Icon name={shell ? 'terminal' : 'file'} size={14} />{label}<small>{raw ? 'raw' : value.language === 'shell' ? 'shell' : value.language === 'json' ? 'JSON' : `${lines} ${lines === 1 ? 'line' : 'lines'}`}</small></span>
      <div className="tool-payload-actions">
        {value.hasRaw && <button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)} aria-label={`Show raw ${label.toLowerCase()}`}>Raw</button>}
        <button type="button" onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}><Icon name={copied === 'copied' ? 'check' : 'copy'} size={13} /><span role="status">{copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}</span></button>
      </div>
    </div>
    {content ? <pre tabIndex={0} aria-label={`${label} content`}><code>{shell ? highlightShell(content).map((token, index) => <span className={`shell-${token.type}`} key={index}>{token.text}</span>) : content}</code></pre> : <p className="tool-payload-empty">No output returned.</p>}
  </section>
}
