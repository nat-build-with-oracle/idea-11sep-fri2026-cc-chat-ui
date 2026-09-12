import { Icon } from './Icon'

export default function SessionIdentity({ sessionId, onCopy }: { sessionId: string | null | undefined; onCopy: (id: string) => void }) {
  if (!sessionId) return null
  return <button type="button" className="session-identity" onClick={() => onCopy(sessionId)} title={`Claude session: ${sessionId} · Click to copy`} aria-label={`Copy Claude session ID ${sessionId}`}>
    <span>Session</span><code>{sessionId}</code><Icon name="copy" size={12} />
  </button>
}
