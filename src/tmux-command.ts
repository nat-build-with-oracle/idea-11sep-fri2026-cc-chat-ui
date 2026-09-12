const MAX_TMUX_NAME_LENGTH = 96

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function asciiSlug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function basename(value?: string) {
  if (!value) return ''
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || ''
}

export function tmuxSessionName(sessionId: string, cwd?: string, title?: string) {
  const repository = asciiSlug(basename(cwd)) || 'claude'
  const sessionFallback = asciiSlug(sessionId.slice(0, 8)) || 'session'
  const label = asciiSlug(title || '') || sessionFallback
  return `${repository}-${label}`.slice(0, MAX_TMUX_NAME_LENGTH).replace(/-+$/g, '')
}

export function tmuxResumeCommand(sessionId: string, cwd?: string, title?: string, dangerous = false) {
  const name = tmuxSessionName(sessionId, cwd, title)
  const claude = `claude --resume ${shellQuote(sessionId)}${dangerous ? ' --dangerously-skip-permissions' : ''}`
  const directory = cwd ? ` -c ${shellQuote(cwd)}` : ''
  return `tmux new-session -d -s ${shellQuote(name)}${directory} ${shellQuote(claude)} &&\nmaw a ${shellQuote(name)}`
}
