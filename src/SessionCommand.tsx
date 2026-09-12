import { Icon } from './Icon'

type SessionCommandProps = {
  sessionId: string | null | undefined
  cwd?: string
  onCopy: (command: string) => void
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function resumeCommand(sessionId: string, cwd?: string) {
  const resume = `claude --resume ${shellQuote(sessionId)}`
  return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume
}

export default function SessionCommand({ sessionId, cwd, onCopy }: SessionCommandProps) {
  if (!sessionId) return null
  const command = resumeCommand(sessionId, cwd)
  return <button
    type="button"
    className="session-command"
    title={command}
    aria-label={`Copy resume command: ${command}`}
    onClick={() => onCopy(command)}
  ><code>{command}</code><Icon name="copy" size={12} /></button>
}
