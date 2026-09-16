import { backendApiUrl, backendTarget } from './backend-target.ts'
import type { AppState, Chat, Health, Project, NativeSession, HistoryPage, RepositoryInventory, SerializedRepositoryPreferences, SessionNameTarget, SessionNameResult } from './types'

export async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const target = backendTarget(window.location.href)
  const options: RequestInit = {
    // 'same-origin', not 'omit': when the UI is served by the backend itself the
    // request is same-origin and must carry the session cookie, which is how the
    // VPN proxy authenticates every call after /_vpn/unlock. A cross-origin
    // backend (hosted frontend + ?host=...) still sends nothing, exactly as
    // 'omit' did, so remote-backend deployments are unchanged.
    credentials: 'same-origin',
    redirect: 'error',
    method,
    ...(signal ? { signal } : {}),
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  }
  let response: Response
  try { response = await fetch(backendApiUrl(window.location.href, path), options) }
  catch (reason) {
    if (signal?.aborted) throw reason
    const detail = reason instanceof Error ? reason.message.slice(0, 240) : 'Network request failed'
    throw new Error(`Cannot reach the backend at ${target.origin}. Browser: ${detail}. Check backend CORS, HTTPS, and this site's local-network permission.`)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}). Please try again.`)
  if (response.status !== 204 && data === null) throw new Error(`The backend at ${target.origin} did not return JSON. Choose a compatible Claude workspace API, not the static frontend address.`)
  return data as T
}

export const api = {
  suggestSessionNames: (target: SessionNameTarget, summaryModel: 'haiku' | 'sonnet', signal?: AbortSignal) => request<SessionNameResult>('/session-names/suggest', 'POST', { target, summaryModel }, signal),
  applySessionAlias: (target: SessionNameTarget, title: string, expectedTitle: string) => request<{ title: string }>('/session-names/alias', 'POST', { target, title, expectedTitle }),
  repositories: () => request<RepositoryInventory>('/repositories'),
  nativeSessions: () => request<{ sessions: NativeSession[] }>('/native-sessions'),
  nativeHistory: (id: string, offset = 0, signal?: AbortSignal) => request<HistoryPage>(`/native-sessions/${encodeURIComponent(id)}/messages?offset=${offset}&limit=100`, 'GET', undefined, signal),
  importSession: (id: string) => request<Chat>(`/native-sessions/${encodeURIComponent(id)}/import`, 'POST'),
  renameNative: (id: string, title: string) => request<{ session: NativeSession; chat: Chat | null }>(`/native-sessions/${encodeURIComponent(id)}`, 'PATCH', { title }),
  state: () => request<AppState>('/state'),
  saveRepositoryPreferences: (preferences: SerializedRepositoryPreferences, seedIfEmpty = false) =>
    request<SerializedRepositoryPreferences>('/repository-preferences', 'POST', { ...preferences, ...(seedIfEmpty ? { seedIfEmpty: true } : {}) }),
  health: () => request<Health>('/health'),
  addProject: (name: string, path: string) => request<Project>('/projects', 'POST', { name, path }),
  createChat: (options: Partial<Pick<Chat, 'title' | 'projectId' | 'model' | 'permissionMode'>>) => request<Chat>('/chats', 'POST', options),
  updateChat: (id: string, options: Partial<Pick<Chat, 'title' | 'projectId' | 'model' | 'permissionMode'>>) => request<Chat>(`/chats/${id}`, 'PATCH', options),
  send: (id: string, content: string) => request<Chat>(`/chats/${id}/messages`, 'POST', { content }),
  syncChat: (id: string) => request<Chat>(`/chats/${encodeURIComponent(id)}/sync`, 'POST'),
  loadChatHistory: (id: string, signal?: AbortSignal) => request<Chat>(`/chats/${id}/history`, 'POST', undefined, signal),
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
