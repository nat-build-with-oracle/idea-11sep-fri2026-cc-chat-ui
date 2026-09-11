import type { AppState, Chat, Health, Project, NativeSession, HistoryPage } from './types'

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}). Please try again.`)
  return data as T
}

export const api = {
  nativeSessions: () => request<{ sessions: NativeSession[] }>('/native-sessions'),
  nativeHistory: (id: string, offset = 0) => request<HistoryPage>(`/native-sessions/${encodeURIComponent(id)}/messages?offset=${offset}&limit=100`),
  importSession: (id: string) => request<Chat>(`/native-sessions/${encodeURIComponent(id)}/import`, 'POST'),
  renameNative: (id: string, title: string) => request<{ session: NativeSession; chat: Chat | null }>(`/native-sessions/${encodeURIComponent(id)}`, 'PATCH', { title }),
  state: () => request<AppState>('/state'),
  health: () => request<Health>('/health'),
  addProject: (name: string, path: string) => request<Project>('/projects', 'POST', { name, path }),
  createChat: (options: Partial<Pick<Chat, 'title' | 'projectId' | 'model' | 'permissionMode'>>) => request<Chat>('/chats', 'POST', options),
  updateChat: (id: string, options: Partial<Pick<Chat, 'title' | 'projectId' | 'model' | 'permissionMode'>>) => request<Chat>(`/chats/${id}`, 'PATCH', options),
  send: (id: string, content: string) => request<Chat>(`/chats/${id}/messages`, 'POST', { content }),
  loadChatHistory: (id: string) => request<Chat>(`/chats/${id}/history`, 'POST'),
  stop: (id: string) => request<Chat>(`/chats/${id}/stop`, 'POST'),
  removeChat: (id: string) => request<unknown>(`/chats/${id}`, 'DELETE'),
}

export function subscribe(onState: (state: AppState) => void, onConnection: (connected: boolean) => void) {
  const source = new EventSource('/api/events')
  source.addEventListener('state', (event: MessageEvent<string>) => {
    try { onState(JSON.parse(event.data) as AppState); onConnection(true) }
    catch { onConnection(false) }
  })
  source.onopen = () => onConnection(true)
  source.onerror = () => onConnection(false)
  return () => source.close()
}
