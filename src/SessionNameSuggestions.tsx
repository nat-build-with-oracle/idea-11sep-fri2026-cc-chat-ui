import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import Dialog from './Dialog'
import type { Health, SessionNameCandidate, SessionNameResult, SessionNameTarget } from './types'

const keyOf = (target: SessionNameTarget) => `${target.kind}:${target.id}`

export default function SessionNameSuggestions({ candidates, capability, onClose, onApplied }: {
  candidates: SessionNameCandidate[]
  capability: Health['sessionNaming']
  onClose: () => void
  onApplied: (target: SessionNameTarget, title: string) => void
}) {
  const [selected, setSelected] = useState(candidates[0] ? keyOf(candidates[0].target) : '')
  const [summaryModel, setSummaryModel] = useState<'haiku' | 'sonnet'>('haiku')
  const [result, setResult] = useState<SessionNameResult | null>(null)
  const [alias, setAlias] = useState('')
  const [phase, setPhase] = useState<'idle' | 'generating' | 'saving'>('idle')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const saving = useRef(false)
  const candidate = candidates.find(item => keyOf(item.target) === selected)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])

  async function generate() {
    if (!candidate || phase !== 'idle' || controller.current) return
    const operation = new AbortController()
    controller.current = operation
    setPhase('generating'); setError(''); setResult(null); setAlias(''); setSaved(false)
    try {
      const names = await api.suggestSessionNames(candidate.target, summaryModel, operation.signal)
      if (!operation.signal.aborted && mounted.current) setResult(names)
    } catch (reason) {
      if (!operation.signal.aborted && mounted.current) setError(reason instanceof Error ? reason.message : 'Could not suggest names. Try again.')
    } finally {
      if (controller.current === operation) controller.current = null
      if (mounted.current) setPhase('idle')
    }
  }

  async function applyAlias() {
    if (!candidate || !result || !alias.trim() || phase !== 'idle' || saving.current) return
    saving.current = true
    setPhase('saving'); setError('')
    try {
      const updated = await api.applySessionAlias(candidate.target, alias.trim(), candidate.title)
      if (mounted.current) { onApplied(candidate.target, updated.title); setSaved(true) }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save this alias. Try again.')
    } finally {
      saving.current = false
      if (mounted.current) setPhase('idle')
    }
  }

  function close() { if (!saving.current) { controller.current?.abort(); onClose() } }

  return <Dialog title="Suggest session names" onClose={close} wide>
    <div className="session-naming">
      <p className="dialog-description">Haiku or Sonnet summarizes the conversation. Opus proposes three names. You decide what to keep.</p>
      {!capability && <p role="alert" className="naming-notice">This backend needs the session-naming update before it can generate suggestions.</p>}
      {candidates.length > 1 ? <label className="field">Session<select value={selected} disabled={phase !== 'idle'} onChange={event => { setSelected(event.target.value); setResult(null); setAlias(''); setSaved(false); setError('') }}>{candidates.map(item => <option key={keyOf(item.target)} value={keyOf(item.target)}>{item.title || 'Untitled thread'} · {item.target.id.slice(0, 8)}</option>)}</select></label> : <p className="naming-current">{candidate?.title || 'Untitled thread'}</p>}
      <div className="naming-controls">
        <label className="field">Summarize with<select value={summaryModel} disabled={phase !== 'idle'} onChange={event => setSummaryModel(event.target.value as 'haiku' | 'sonnet')}><option value="haiku">Haiku</option><option value="sonnet">Sonnet</option></select></label>
        <p className="field-help">Then Opus suggests names</p>
      </div>
      <p className="field-help">Generate sends a bounded text excerpt to Claude. Two model calls; normal usage charges apply. No tools, session resume, or automatic renaming.</p>
      <button className="subtle-button" type="button" disabled={!candidate || !capability || phase !== 'idle'} onClick={() => void generate()}>{phase === 'generating' ? 'Summarizing and suggesting…' : result ? 'Generate again' : 'Generate suggestions'}</button>
      {phase === 'generating' && <p role="status" className="field-help">Reading an excerpt, then asking for three names. You can cancel without changing the session.</p>}
      {error && <p role="alert" className="naming-notice">{error}</p>}
      {result && <div className="naming-results">
        <details className="naming-summary"><summary>Summary · {result.messageCount} {result.messageCount === 1 ? 'message' : 'messages'}{result.truncated ? ' · excerpt' : ''}</summary><p>{result.summary}</p></details>
        <fieldset disabled={phase !== 'idle'} className="naming-choices"><legend>Choose a suggested name</legend>{result.suggestions.map(suggestion => <label key={suggestion}><input type="radio" name="suggested-alias" value={suggestion} checked={alias === suggestion} onChange={() => { setAlias(suggestion); setSaved(false) }} /><span>{suggestion}</span></label>)}</fieldset>
        <label className="field">Display alias<input value={alias} maxLength={120} disabled={phase !== 'idle'} onChange={event => { setAlias(event.target.value); setSaved(false) }} placeholder="Choose a suggestion, or write your own" /></label>
        <p className="field-help">Saved in ARRA only. The original CLI name, session ID, and history stay unchanged.</p>
      </div>}
      {saved && <p role="status" className="naming-saved">Display alias saved. Original session unchanged.</p>}
      <div className="dialog-footer"><button type="button" className="subtle-button" onClick={close} disabled={phase === 'saving'}>{phase === 'generating' ? 'Cancel generation' : 'Done'}</button>{result && <button type="button" className="primary-button" disabled={phase !== 'idle' || !alias.trim() || alias.trim() === candidate?.title || saved} onClick={() => void applyAlias()}>{phase === 'saving' ? 'Saving…' : 'Save alias'}</button>}</div>
    </div>
  </Dialog>
}
