import type { Chat } from './types'

export const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'] as const

type StoredChatIdentity = Pick<Chat, 'provider' | 'model'>

export function isWritableClaudeChat(chat: StoredChatIdentity) {
  return (chat.provider === undefined || chat.provider === 'claude') && CLAUDE_MODELS.includes(chat.model as (typeof CLAUDE_MODELS)[number])
}

export function chatReadOnlyReason(chat: StoredChatIdentity) {
  if ((chat.provider !== undefined && chat.provider !== 'claude') || chat.model.toLowerCase().startsWith('glm')) {
    return 'This conversation used a removed provider and is kept read-only. Its saved history is unchanged; start a new Claude conversation to continue.'
  }
  if (!CLAUDE_MODELS.includes(chat.model as (typeof CLAUDE_MODELS)[number])) {
    return `This conversation uses an unsupported stored model (${chat.model}) and is kept read-only. Its saved history is unchanged; start a new Claude conversation to continue.`
  }
  return ''
}
