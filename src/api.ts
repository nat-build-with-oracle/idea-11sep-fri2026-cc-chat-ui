import { backendApiUrl, backendTarget } from './backend-target.ts'
import type { AppState, Chat, Health, Project, NativeSession, HistoryPage, RepositoryInventory } from './types'

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const target = backendTarget(window.location.href)
  const options: RequestInit = {
    credentials: 'omit',
    redirect: 'error',
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  }
  let response: Response
  try { response = await fetch(backendApiUrl(window.location.href, path), options) }
  catch (reason) {
    const detail = reason instanceof Error ? reason.message.slice(0, 240) : 'Network request failed'
    throw new Error(`Cannot reach the backend at ${target.origin}. Browser: ${detail}. Check backend CORS, HTTPS, and this site's local-network permission.`)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}). Please try again.`)
  if (response.status !== 204 && data === null) throw new Error(`The backend at ${target.origin} did not return JSON. Choose a compatible Claude workspace API, not the static frontend address.`)
  return data as T
}

export const api = {
  repositories: () => request<RepositoryInventory>('/repositories'),
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
  const source = new EventSource(backendApiUrl(window.location.href, '/events'))
  source.addEventListener('state', (event: MessageEvent<string>) => {
    try { onState(JSON.parse(event.data) as AppState); onConnection(true) }
    catch { onConnection(false) }
  })
  source.onopen = () => onConnection(true)
  source.onerror = () => onConnection(false)
  return () => source.close()
}
