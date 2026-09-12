export interface SlashCommand {
  token: '/rename' | '/list-agents'
  description: string
}

export interface SlashCommandQuery {
  start: number
  end: number
  fragment: string
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { token: '/rename', description: 'Rename this conversation' },
  { token: '/list-agents', description: 'Find running Claude agents' },
]

export function slashCommandQueryAtCaret(text: string, caret: number): SlashCommandQuery | null {
  const caretPosition = Math.max(0, Math.min(caret, text.length))
  const prefix = text.slice(0, caretPosition)
  const match = prefix.match(/^\s*\/([^\s/]*)$/u)
  if (!match) return null
  const remainingToken = text.slice(caretPosition).match(/^[^\s/]*/u)?.[0] ?? ''
  return {
    start: prefix.lastIndexOf('/'),
    end: caretPosition + remainingToken.length,
    fragment: match[1],
  }
}

export function matchSlashCommands(
  query: SlashCommandQuery | string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): SlashCommand[] {
  const fragment = (typeof query === 'string' ? query : query.fragment)
    .replace(/^\//, '')
    .toLocaleLowerCase()
  return commands.filter(command => command.token.slice(1).toLocaleLowerCase().startsWith(fragment))
}

export function insertSlashCommand(
  text: string,
  query: SlashCommandQuery,
  command: SlashCommand,
): { text: string; caret: number } {
  const suffix = text.slice(query.end)
  const hasSeparator = /^\s/u.test(suffix)
  const insertion = `${command.token}${hasSeparator ? '' : ' '}`
  return {
    text: `${text.slice(0, query.start)}${insertion}${suffix}`,
    caret: query.start + command.token.length + 1,
  }
}
