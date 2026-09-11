import type { AppRoute } from './routes'
import type { Chat, NativeSession } from './types'

const previewId = (id: string) => /^preview-\d+$/.test(id)

export function initialRoute(preview: boolean, selected: string, project: string): AppRoute {
  if (preview) return { view: 'chat', chatId: 'preview-0' }
  // Older previews wrote their fixture ID into live preferences.
  if (previewId(selected)) return { view: 'new', projectId: null }
  return selected ? { view: 'chat', chatId: selected } : { view: 'new', projectId: project || null }
}

export function recoverChatRoute(route: AppRoute, chats: readonly Chat[], sessions: readonly NativeSession[], fromRememberedSelection: boolean): AppRoute | null {
  if (route.view !== 'chat' || chats.some(chat => chat.id === route.chatId)) return null
  const imported = chats.find(chat => chat.sessionId === route.chatId)
  if (imported) return { view: 'chat', chatId: imported.id }
  if (sessions.some(session => session.sessionId === route.chatId)) return { view: 'native', sessionId: route.chatId, tab: 'saved', search: '' }
  if (previewId(route.chatId) || fromRememberedSelection) return { view: 'new', projectId: null }
  return null
}
