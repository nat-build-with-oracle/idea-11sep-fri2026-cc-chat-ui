import { useId, useState, type KeyboardEvent, type RefObject } from 'react'
import { containsCompleteToken, insertMentionToken, matchMentionCandidates, mentionKindLabel, mentionQueryAtCaret, type MentionCandidate, type MentionQuery } from './mentions'

const MAX_SELECTED = 32

type MentionComposerProps = {
  value: string
  onChange: (value: string) => void
  candidates: MentionCandidate[]
  selected: MentionCandidate[]
  onSelectedChange: (selected: MentionCandidate[]) => void
  disabled: boolean
  placeholder: string
  inputRef: RefObject<HTMLTextAreaElement | null>
}

function shortSessionId(sessionId?: string) {
  return sessionId ? sessionId.slice(0, 8) : ''
}

function candidateMetadata(candidate: MentionCandidate) {
  const id = shortSessionId(candidate.sessionId)
  return id ? `${candidate.path} · ${id}` : candidate.path
}

function candidateTitle(candidate: MentionCandidate) {
  return candidate.sessionId ? `${candidate.path} · ${candidate.sessionId}` : candidate.path
}

function selectedKindLabel(candidate: MentionCandidate) {
  const label = mentionKindLabel(candidate)
  const id = shortSessionId(candidate.sessionId)
  return id ? `${label} · ${id}` : label
}

function isCompleteTokenAt(value: string, token: string, index: number) {
  return containsCompleteToken(value.slice(Math.max(0, index - 1), index + token.length + 1), token)
}

export function removeMentionFromDraft(value: string, token: string) {
  let next = value
  let index = next.indexOf(token)
  while (index !== -1) {
    if (!isCompleteTokenAt(next, token, index)) {
      index = next.indexOf(token, index + token.length)
      continue
    }
    let start = index
    let end = index + token.length
    if (next[end] === ' ') end += 1
    else if (start > 0 && next[start - 1] === ' ') start -= 1
    next = `${next.slice(0, start)}${next.slice(end)}`
    index = next.indexOf(token)
  }
  return next
}

export function boundMentionCandidate(candidate: MentionCandidate, selected: readonly MentionCandidate[]) {
  return selected.find(item => item.key === candidate.key) ?? candidate
}

export default function MentionComposer({ value, onChange, candidates, selected, onSelectedChange, disabled, placeholder, inputRef }: MentionComposerProps) {
  const listboxId = useId()
  const [query, setQuery] = useState<MentionQuery | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const matches = query ? matchMentionCandidates(candidates, query) : []
  const optionIndex = matches.length ? Math.min(activeIndex, matches.length - 1) : 0
  const selectedAtLimit = selected.length >= MAX_SELECTED

  function updateQuery(text: string, caret: number | null) {
    setQuery(caret === null ? null : mentionQueryAtCaret(text, caret))
    setActiveIndex(0)
  }

  function restoreCaret(caret: number) {
    queueMicrotask(() => {
      const textarea = inputRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
    })
  }

  function choose(candidate: MentionCandidate) {
    if (!query) return
    const alreadySelected = selected.some(item => item.key === candidate.key)
    const boundCandidate = boundMentionCandidate(candidate, selected)
    if (selectedAtLimit && !alreadySelected) {
      setQuery(null)
      return
    }
    const inserted = insertMentionToken(value, query, boundCandidate)
    onChange(inserted.text)
    if (!alreadySelected) onSelectedChange([...selected, candidate].slice(0, MAX_SELECTED))
    setQuery(null)
    restoreCaret(inserted.text[inserted.caret] === ' ' ? inserted.caret + 1 : inserted.caret)
  }

  function remove(candidate: MentionCandidate) {
    const next = removeMentionFromDraft(value, candidate.token)
    onChange(next)
    onSelectedChange(selected.filter(item => item.key !== candidate.key))
    setQuery(null)
    restoreCaret(Math.min(inputRef.current?.selectionStart ?? next.length, next.length))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && event.shiftKey) return
    if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex(current => (current + direction + matches.length) % matches.length)
      return
    }
    if (matches.length && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault()
      choose(matches[optionIndex])
      return
    }
    if (query && event.key === 'Escape') {
      event.preventDefault()
      setQuery(null)
      return
    }
    if (query && !matches.length && event.key === 'Enter') {
      event.preventDefault()
      setQuery(null)
      return
    }
    if (!query && event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return <div className="mention-composer">
    {query && <div className="mention-menu" id={listboxId} role="listbox" aria-label="Reference an Oracle, repository, or session">
      {matches.map((candidate, index) => <button
        type="button"
        role="option"
        aria-selected={index === optionIndex}
        className={`mention-option ${index === optionIndex ? 'active' : ''}`}
        id={`${listboxId}-option-${index}`}
        key={candidate.key}
        disabled={selectedAtLimit && !selected.some(item => item.key === candidate.key)}
        onMouseDown={event => event.preventDefault()}
        onClick={() => choose(candidate)}
      >
        <span className={`mention-kind ${candidate.kind}`}>{mentionKindLabel(candidate)}</span>
        <span className="mention-option-copy"><strong>{candidate.name}</strong><span title={candidateTitle(candidate)}>{candidateMetadata(candidate)}</span></span>
      </button>)}
      {!matches.length && <p className="mention-empty" role="status">No matching Oracles, repositories or sessions.</p>}
    </div>}
    <textarea
      ref={inputRef}
      value={value}
      onChange={event => {
        const next = event.currentTarget.value
        onChange(next)
        const retained = selected.filter(candidate => containsCompleteToken(next, candidate.token)).slice(0, MAX_SELECTED)
        if (retained.length !== selected.length) onSelectedChange(retained)
        updateQuery(next, event.currentTarget.selectionStart)
      }}
      onSelect={event => updateQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
      onClick={event => updateQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
      onBlur={() => setQuery(null)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      aria-label="Message Claude"
      aria-autocomplete="list"
      aria-controls={query ? listboxId : undefined}
      aria-expanded={Boolean(query)}
      aria-activedescendant={matches.length ? `${listboxId}-option-${optionIndex}` : undefined}
      rows={2}
      disabled={disabled}
    />
    {selected.length > 0 && <div className="mention-selection" aria-label="Selected references">
      <div className="mention-chips">{selected.map(candidate => <button
        type="button"
        className="mention-chip"
        key={candidate.key}
        title={`Remove ${candidate.name} · ${candidate.path}${candidate.sessionId ? ` · ${candidate.sessionId}` : ''}`}
        aria-label={`Remove ${candidate.name} reference`}
        onClick={() => remove(candidate)}
        disabled={disabled}
      ><span>{candidate.name}</span><small>{selectedKindLabel(candidate)}</small><b aria-hidden="true">×</b></button>)}</div>
      {selectedAtLimit && <p className="mention-limit" role="status">Reference limit reached · remove one to add another.</p>}
      <p>References share names, IDs and paths—not conversation history.</p>
    </div>}
  </div>
}
