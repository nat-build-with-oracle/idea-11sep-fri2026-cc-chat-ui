import { Icon } from './Icon'
import { tmuxResumeCommand, tmuxSessionName } from './tmux-command'
import type { NativeSession } from './types'
import { chatReadOnlyReason } from './claude-chat'

type SessionCommandProps = {
  sessionId: string | null | undefined
  cwd?: string
  title?: string
  provider?: string
  model?: string
  readOnlyReason?: string
  existingTerminal?: NativeSession['existingTerminal']
  onCopy: (command: string, kind: 'attach' | 'resume' | 'tmux' | 'oneshot') => void
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function resumeCommand(sessionId: string, cwd?: string, dangerous = false) {
  const resume = `claude --resume ${shellQuote(sessionId)}${dangerous ? ' --dangerously-skip-permissions' : ''}`
  return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume
}

export function oneShotCommand(sessionId: string, cwd?: string, dangerous = false) {
  return `${resumeCommand(sessionId, cwd, dangerous)} -p ${shellQuote('Reply with exactly: ARRA sync test OK. Do not use tools or modify files.')} --tools ''`
}

export default function SessionCommand({ sessionId, cwd, title, provider = 'claude', model = 'sonnet', readOnlyReason: explicitReadOnlyReason, existingTerminal, onCopy }: SessionCommandProps) {
  if (!sessionId) return null
  const readOnlyReason = explicitReadOnlyReason || chatReadOnlyReason({ provider, model })
  if (readOnlyReason) return <div className="field-help">{readOnlyReason} Claude launch commands are unavailable for this read-only record.</div>
  const command = resumeCommand(sessionId, cwd)
  const tmux = tmuxResumeCommand(sessionId, cwd, title)
  const name = tmuxSessionName(sessionId, cwd, title)
  const oneShot = oneShotCommand(sessionId, cwd)
  const commands = [
    ...(existingTerminal ? [{ kind: 'attach' as const, label: `Existing terminal · ${existingTerminal.sessionName} · ${existingTerminal.target}`, text: existingTerminal.attachCommand, dangerous: false }] : []),
    { kind: 'resume', label: 'Resume in terminal', text: command, dangerous: false },
    { kind: 'tmux', label: `New tmux · ${name}`, text: tmux, dangerous: false },
    { kind: 'oneshot', label: 'One-shot sync test', text: oneShot, dangerous: false },
    { kind: 'resume', label: 'Full access · Resume in terminal', text: resumeCommand(sessionId, cwd, true), dangerous: true },
    { kind: 'tmux', label: `Full access · New tmux · ${name}`, text: tmuxResumeCommand(sessionId, cwd, title, true), dangerous: true },
    { kind: 'oneshot', label: 'Full access · One-shot sync test (tools off)', text: oneShotCommand(sessionId, cwd, true), dangerous: true },
  ] as const
  return <div className="session-commands"><button
    type="button"
    className="session-command"
    title={command}
    aria-label={`Copy resume command: ${command}`}
    onClick={() => onCopy(command, 'resume')}
  ><code>{command}</code><Icon name="copy" size={12} /></button><button
    type="button"
    className="tmux-command"
    title={`New tmux: ${name}\n${tmux}\nCopy only. Finish the existing Claude writer before running.`}
    aria-label={`Copy tmux command for ${name}`}
    onClick={() => onCopy(tmux, 'tmux')}
  ><Icon name="terminal" size={13} />Copy new tmux</button><button
    type="button"
    className="tmux-command"
    title={`${oneShot}\nCopy only. Running uses Claude quota and appends a test turn to this session. Finish the existing writer first.`}
    aria-label="Copy one-shot test command"
    onClick={() => onCopy(oneShot, 'oneshot')}
  ><Icon name="copy" size={12} />Copy -p test</button>{existingTerminal && <button
    type="button"
    className="tmux-command existing-terminal-command"
    title={`Existing terminal · ${existingTerminal.target}\n${existingTerminal.attachCommand}`}
    aria-label={`Copy existing terminal command for ${existingTerminal.target}`}
    onClick={() => onCopy(existingTerminal.attachCommand, 'attach')}
  ><Icon name="terminal" size={13} />Copy existing terminal</button>}
    <details className="session-command-details">
      <summary><Icon name="chevron" size={12} /><span className="commands-show-label">Show all commands</span><span className="commands-hide-label">Hide commands</span></summary>
      <div className="session-command-list" role="region" aria-label="Full session commands" tabIndex={0}>
        <p>Copy only—nothing runs here. Existing terminal attach is safe while its owner is open. Before running resume, new tmux, or one-shot commands, finish any existing Claude writer. The one-shot test adds a turn and uses Claude quota.<span className="command-danger-warning">Full access bypasses permission checks: Claude can run commands or modify files without asking. Use trusted projects. One-shot sync tests keep tools disabled.</span></p>
        {commands.map(item => <section className={`session-command-card${item.dangerous ? ' dangerous' : ''}`} key={`${item.kind}-${item.dangerous}`}>
          <div><strong>{item.label}</strong><button type="button" className="tmux-command" aria-label={`Copy full ${item.label} command`} onClick={() => onCopy(item.text, item.kind)}><Icon name="copy" size={12} />Copy</button></div>
          <pre><code>{item.text}</code></pre>
        </section>)}
      </div>
    </details>
  </div>
}
