import { backendTarget, isLoopback, workspaceStorageKey, workspaceLink } from './backend-target'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import { startWorkspaceConnection } from './workspace-connection'
import type { AppState, Chat, Health, Message, Model, NativeSession, PermissionMode, RepositoryInventory } from './types'
import { Icon, ClaudeMark, type IconName } from './Icon'
import Markdown from './Markdown'
import Dialog from './Dialog'
import ConnectionHelp from './ConnectionHelp'
import Appearance from './Appearance'
import Activity from './Activity'
import { buildConversationItems } from './activity-model'
import { previewState } from './preview'
import { useBrowserRoute } from './useBrowserRoute'
import UsageInfo from './UsageInfo'
import TranscriptSyncStatus from './TranscriptSyncStatus'
import HistoryLoadControls from './HistoryLoadControls'
import { loadRemainingHistory, mergeHistoryMessages } from './history-loading'
import { RepositoryActions, SidebarThread } from './SidebarActions'
import { parseRepositoryPreferences, serializeRepositoryPreferences, setRepositoryFavorite, setRepositoryName, setRepositoryThreadSort, applyRepositoryPreferences, type RepositoryPreferences } from './repository-preferences'
import { sortRepositoryThreads } from './repository-threads'
import { parseHiddenRepositories, changeRepositoryVisibility } from './repository-visibility'
import { initialRoute, recoverChatRoute } from './route-recovery'
import { buildWorkspaceRepositories, type WorkspaceRepository } from './workspace-model'
import { sessionGroup, sessionGroups, sessionsForTab } from './session-list'

const preview = new URLSearchParams(window.location.search).get('preview') === 'oracle'
const modelNames: Record<Model, string> = { sonnet: 'Claude Sonnet', opus: 'Claude Opus', haiku: 'Claude Haiku' }
type RenameTarget = { kind: 'chat'; id: string } | { kind: 'native'; id: string } | { kind: 'draft' }
function stored(key: string, fallback = '') { try { return localStorage.getItem(workspaceStorageKey(window.location.href, key)) ?? fallback } catch { return fallback } }
function remember(key: string, value: string) { if (preview) return; try { localStorage.setItem(workspaceStorageKey(window.location.href, key), value) } catch { /* Storage may be unavailable in private browsing. */ } }
function timeLabel(date: string) { const value = new Date(date); return Number.isNaN(value.valueOf()) ? '' : value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.' }
function IconButton({ icon, label, onClick, active, disabled }: { icon: IconName; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon name={icon} /></button>
}
function MessageBody({ message }: { message: Message }) {
  return <Markdown content={message.content} />
}

export default function App() {
  const fromRememberedSelection = useRef(!window.location.hash)
  const { route, navigate, version: navigation } = useBrowserRoute(() => initialRoute(preview, stored('selected'), stored('project')))
  const view = route.view === 'new' ? 'chat' : route.view
  const selectedId = route.view === 'chat' ? route.chatId : null
  const filter = route.view === 'agents' || route.view === 'native' ? route.search : ''
  const sessionTab = route.view === 'agents' || route.view === 'native' ? route.tab : 'agents'

  const [state, setState] = useState<AppState>(preview ? previewState : { projects: [], chats: [] })
  const [health, setHealth] = useState<Health | null>(null)
  const [loaded, setLoaded] = useState(preview)
  const [connected, setConnected] = useState(preview)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const [connectionIssue, setConnectionIssue] = useState('')
  const [connectionHelpOpen, setConnectionHelpOpen] = useState(false)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const connectionError = useRef('')
  const connectionRecovery = useRef(0)
  const [projectId, setProjectId] = useState(preview ? 'mother-oracle' : route.view === 'new' ? route.projectId || '' : stored('project'))
  const [model, setModel] = useState<Model>('sonnet')
  const [permission, setPermission] = useState<PermissionMode>('bypassPermissions')
  const [repositoryInventory, setRepositoryInventory] = useState<RepositoryInventory>({ root: null, repositories: [] })
  const [repositoriesLoading, setRepositoriesLoading] = useState(!preview)
  const [hiddenRepositories, setHiddenRepositories] = useState(() => preview ? new Set<string>() : parseHiddenRepositories(stored('hidden-repositories', '[]')))
  const [repositoryPreferences, setRepositoryPreferences] = useState(() => parseRepositoryPreferences(preview ? '{}' : stored('repository-preferences', '{}')))
  const [repositorySearch, setRepositorySearch] = useState('')
  const [repositoryLimit, setRepositoryLimit] = useState(20)
  const repositoryRequest = useRef(0)
  const [nativeListLoaded, setNativeListLoaded] = useState(preview)
  const [nativeSessions, setNativeSessions] = useState<NativeSession[]>([])
  const [native, setNative] = useState<NativeSession | null>(null)
  const [nativeMessages, setNativeMessages] = useState<Message[]>([])
  const [nativeOffset, setNativeOffset] = useState<number | null>(null)
  const [nativeLoading, setNativeLoading] = useState(false)
  const [nativeListLoading, setNativeListLoading] = useState(false)
  const nativeListRequest = useRef(0)
  const [nativeError, setNativeError] = useState('')
  const [draft, setDraft] = useState(() => preview ? '' : stored(`draft:${selectedId || `new:${projectId}`}`))
  const [busy, setBusy] = useState(false)
  const historyRequest = useRef<AbortController | null>(null)
  const [historyLoading, setHistoryLoading] = useState<'page' | 'all' | null>(null)
  const [historyPages, setHistoryPages] = useState(0)
  const [historyNotice, setHistoryNotice] = useState('')
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [syncingChatId, setSyncingChatId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [projectExpansion, setProjectExpansion] = useState<Record<string, boolean>>({})
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<'project' | 'search' | 'rename' | 'settings' | 'remove' | null>(null)
  const [titleInput, setTitleInput] = useState('')
  const [renameTarget, setRenameTarget] = useState<RenameTarget>({ kind: 'draft' })
  const [newTitle, setNewTitle] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [search, setSearch] = useState('')
  const composer = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const chat = view === 'chat' ? state.chats.find(item => item.id === selectedId) ?? null : null
  const baseRepositoryRows = useMemo(() => buildWorkspaceRepositories(state.projects, repositoryInventory.repositories, nativeSessions, state.chats), [state.projects, repositoryInventory.repositories, nativeSessions, state.chats])
  const repositoryRows = useMemo(() => applyRepositoryPreferences(baseRepositoryRows, repositoryPreferences), [baseRepositoryRows, repositoryPreferences])
  const matchingRepositories = repositoryRows.filter(repo => !hiddenRepositories.has(repo.path.replace(/\/+$/, '') || '/') && `${repo.name} ${repo.path}`.toLowerCase().includes(repositorySearch.toLowerCase()))
  const favoriteRepositories = matchingRepositories.filter(repo => repositoryPreferences.favorites.has(repo.path.replace(/\/+$/, '') || '/'))
  const recentRepositories = matchingRepositories.filter(repo => !repositoryPreferences.favorites.has(repo.path.replace(/\/+$/, '') || '/'))
  const visibleRepositories = repositorySearch ? matchingRepositories : [...favoriteRepositories, ...recentRepositories.slice(0, repositoryLimit)]
  const selectedProject = repositoryRows.find(item => item.aliases.includes((chat ? chat.projectId : projectId) || ''))
  const missingNewProject = loaded && !repositoriesLoading && route.view === 'new' && Boolean(route.projectId) && !selectedProject
  const currentModel = chat?.model ?? model
  const currentPermission = chat?.permissionMode ?? permission
  const running = chat?.status === 'running'
  const currentTitle = view === 'agents' ? 'Your corner' : view === 'native' ? native?.name || 'Claude session' : selectedId && !chat ? loaded ? 'Conversation not found' : 'Loading conversation…' : chat?.title || newTitle || 'New conversation'
  const messages = view === 'native' ? nativeMessages : chat?.messages ?? []
  const conversationItems = buildConversationItems(messages)
  const visibleSessions = sessionsForTab(nativeSessions, sessionTab, filter)
  const nextHistory = view === 'native' ? nativeOffset : chat?.historyNextOffset ?? null
  const importedHistoryPending = Boolean(chat?.nativeImported && nextHistory !== null)
  const latestAssistant = [...messages].reverse().find(message => message.role === 'assistant')

  useEffect(() => {
    if (preview) return
    return startWorkspaceConnection({
      onState: data => { setState(data); setLoaded(true) },
      onHealth: setHealth,
      onConnection: setConnected,
      onIssue: reason => { reportConnectionIssue(reason); setLoaded(true) },
      onRecovered: () => {
        connectionRecovery.current += 1
        const previous = connectionError.current
        connectionError.current = ''
        setError(current => current === previous ? '' : current)
        setConnectionIssue(''); setConnectionHelpOpen(false)
        if (previous) { void refreshRepositories(); void refreshNative() }
      },
    })
  }, [connectionAttempt])
  useEffect(() => {
    historyRequest.current?.abort()
    setHistoryNotice(''); setHistoryPages(0)
    setShowJumpToBottom(false)
    setError(''); setModal(null); setDetailsOpen(false); setSidebarOpen(false); nearBottom.current = true
    if (preview) return
    if (route.view === 'chat') {
      remember('selected', route.chatId); setDraft(stored(`draft:${route.chatId}`))
    } else if (route.view === 'new') {
      const id = route.projectId || ''
      remember('selected', ''); remember('project', id); setProjectId(id); setNewTitle(''); setDraft(stored(`draft:new:${id}`))
    }
  }, [route])
  useEffect(() => () => { historyRequest.current?.abort() }, [])
  useEffect(() => { void refreshRepositories() }, [])
  useEffect(() => { void refreshNative() }, [view === 'agents'])
  useEffect(() => {
    if (preview || !loaded || chat) return
    const fallback = recoverChatRoute(route, state.chats, nativeSessions, nativeListLoaded && fromRememberedSelection.current && navigation.current === 0)
    if (fallback) { navigate(fallback, true); setToast('Opened your live workspace instead of an unavailable link') }
  }, [route, loaded, chat, state.chats, nativeSessions, nativeListLoaded, navigate])
  const nativeRouteId = route.view === 'native' ? route.sessionId : null
  useEffect(() => {
    if (!nativeRouteId || preview) return
    const requestId = navigation.current
    let alive = true
    setNative(null); setNativeMessages([]); setNativeOffset(null); setNativeLoading(true); setError('')
    void (async () => {
      try {
        const data = await api.nativeSessions()
        if (!alive || requestId !== navigation.current) return
        setNativeSessions(data.sessions)
        const session = data.sessions.find(item => item.sessionId === nativeRouteId)
        if (!session) throw new Error('This Claude session is no longer available. Go back to Your chats and refresh the list.')
        setNative(session)
        const page = await api.nativeHistory(nativeRouteId)
        if (!alive || requestId !== navigation.current) return
        setNativeMessages(page.messages); setNativeOffset(page.nextOffset)
      } catch (reason) { if (alive && requestId === navigation.current) setError(errorMessage(reason)) }
      finally { if (alive && requestId === navigation.current) setNativeLoading(false) }
    })()
    return () => { alive = false }
  }, [route, connectionAttempt])
  useEffect(() => { document.title = `${currentTitle} — ARRA Claude Code` }, [currentTitle])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer) }, [toast])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearch(''); setModal('search') }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); newChat() }
      if (event.key === 'Escape') { setSidebarOpen(false); setDetailsOpen(false) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  useLayoutEffect(() => { if (scroller.current && nearBottom.current) scroller.current.scrollTop = scroller.current.scrollHeight }, [selectedId, view, messages.length, messages.at(-1)?.content, messages.at(-1)?.tools?.length])
  useLayoutEffect(() => { const node = composer.current; if (node) { node.style.height = 'auto'; node.style.height = `${Math.min(node.scrollHeight, 220)}px` } }, [draft])

  function applyChat(updated: Chat) {
    setState(previous => {
      const existing = previous.chats.find(item => item.id === updated.id)
      if (existing && existing.updatedAt >= updated.updatedAt) return previous
      return { ...previous, chats: [updated, ...previous.chats.filter(item => item.id !== updated.id)] }
    })
  }
  function reportConnectionIssue(reason: unknown) {
    const message = errorMessage(reason)
    connectionError.current = message
    setError(message); setConnectionIssue(message); setConnectionHelpOpen(true)
  }
  async function retryConnection() {
    if (checkingConnection) return
    setCheckingConnection(true)
    const recovery = connectionRecovery.current
    try {
      // Start the read-only fetch directly from the click, before awaiting anything.
      const result = await api.health()
      if (!result.ok) throw new Error('The backend did not report a healthy connection.')
      setHealth(result)
      if (recovery === connectionRecovery.current) setConnectionAttempt(attempt => attempt + 1)
    } catch (reason) { if (recovery === connectionRecovery.current) reportConnectionIssue(reason) }
    finally { setCheckingConnection(false) }
  }
  function changeDraft(value: string) { setDraft(value); remember(`draft:${selectedId || `new:${projectId}`}`, value) }
  function jumpToBottom() {
    nearBottom.current = true
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior })
    setShowJumpToBottom(false)
  }
  function selectChat(item: Chat, replace = false) {
    navigate({ view: 'chat', chatId: item.id }, replace)
  }
  function newChat(targetProjectId = projectId) {
    if (preview) { window.location.href = workspaceLink(window.location.href, false); return }
    navigate({ view: 'new', projectId: targetProjectId || null })
    requestAnimationFrame(() => composer.current?.focus())
  }
  async function refreshRepositories() {
    if (preview) return
    const requestId = ++repositoryRequest.current
    setRepositoriesLoading(true)
    try { const data = await api.repositories(); if (requestId === repositoryRequest.current) setRepositoryInventory(data) }
    catch (reason) { if (requestId === repositoryRequest.current) setRepositoryInventory(previous => ({ ...previous, warning: errorMessage(reason) })) }
    finally { if (requestId === repositoryRequest.current) setRepositoriesLoading(false) }
  }
  async function refreshNative() {
    if (preview) return
    const requestId = ++nativeListRequest.current
    setNativeListLoading(true); setNativeError('')
    try { const data = await api.nativeSessions(); if (requestId === nativeListRequest.current) { setNativeSessions(data.sessions); setNativeListLoaded(true) } }
    catch (reason) { if (requestId === nativeListRequest.current) setNativeError(errorMessage(reason)) }
    finally { if (requestId === nativeListRequest.current) setNativeListLoading(false) }
  }
  async function ensureProject(id: string) {
    if (!id || state.projects.some(project => project.id === id)) return id
    const repo = baseRepositoryRows.find(item => item.aliases.includes(id))
    if (!repo) throw new Error('Repository is no longer available. Refresh the repository list.')
    const project = await api.addProject(repo.name, repo.path)
    setState(previous => ({ ...previous, projects: [...previous.projects.filter(item => item.id !== project.id), project] }))
    return project.id
  }
  function showAgents() { navigate({ view: 'agents', tab: sessionTab, search: view === 'native' ? filter : '' }) }
  function selectNative(item: NativeSession) {
    if (!item.sessionId) { setError('This process has not created a conversation yet. Refresh once it starts.'); return }
    const existing = state.chats.find(current => current.sessionId === item.sessionId)
    if (existing && item.action === 'resume') { selectChat(existing); return }
    navigate({ view: 'native', sessionId: item.sessionId, tab: sessionTab, search: filter })
  }
  async function importNative() {
    if (!native?.sessionId) return
    const requestId = navigation.current
    const sessionId = native.sessionId
    setBusy(true); setError('')
    try {
      const item = await api.importSession(sessionId)
      const data = await api.state()
      if (requestId === navigation.current) { setState(data); selectChat(item, true) }
    }
    catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  async function loadHistory(all = false) {
    const id = view === 'native' ? native?.sessionId : chat?.sessionId
    if (!id || nextHistory === null || busy || running || historyRequest.current || preview) return
    const requestId = navigation.current
    const requestView = view
    const controller = new AbortController()
    historyRequest.current = controller
    let updatedChat: Chat | null = null
    let pages = 0
    nearBottom.current = false
    setShowJumpToBottom(true)
    setBusy(true); setHistoryLoading(all ? 'all' : 'page'); setHistoryPages(0); setHistoryNotice(''); setError('')
    try {
      const result = await loadRemainingHistory({
        offset: nextHistory,
        signal: controller.signal,
        loadPage: async offset => {
          if (requestView === 'native') return api.nativeHistory(id, offset, controller.signal)
          if (!chat) throw new Error('Conversation is no longer available.')
          updatedChat = await api.loadChatHistory(chat.id, controller.signal)
          return { messages: updatedChat.messages, nextOffset: updatedChat.historyNextOffset ?? null }
        },
        onPage: page => {
          if (requestId !== navigation.current) { controller.abort(); return }
          nearBottom.current = false
          if (requestView === 'native') {
            setNativeMessages(previous => mergeHistoryMessages(previous, page.messages)); setNativeOffset(page.nextOffset)
          } else if (updatedChat) applyChat(updatedChat)
        },
        onProgress: progress => {
          pages = progress.pages
          if (requestId === navigation.current) setHistoryPages(pages)
          if (!all) controller.abort()
        },
      })
      if (requestId === navigation.current) {
        setHistoryNotice(result.complete ? 'All available history is loaded.' : result.reason === 'limit' ? 'Loaded 100 pages. More history remains—choose Load all remaining to continue.' : all || !pages ? 'Loading stopped. Pages already loaded are kept.' : '')
      }
    } catch (reason) {
      if (requestId === navigation.current) {
        setError(errorMessage(reason)); setHistoryNotice('Pages already loaded are kept. Choose Load all remaining to retry.')
      }
    } finally {
      if (historyRequest.current === controller) {
        historyRequest.current = null; setBusy(false); setHistoryLoading(null)
      }
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || busy || running || importedHistoryPending || missingNewProject || preview || (route.view === 'chat' && !chat)) return
    if (content === '/rename') { openRename(); return }
    if (content.startsWith('/rename ')) {
      const title = content.slice(8).trim()
      if (title) {
        const requestId = navigation.current
        setBusy(true)
        try {
          if (chat) applyChat(await api.updateChat(chat.id, { title })); else setNewTitle(title)
          if (requestId === navigation.current) { changeDraft(''); setToast('Conversation renamed') }
        } catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) } finally { setBusy(false) }
      }
      return
    }
    setBusy(true); setError(''); nearBottom.current = true
    const draftKey = selectedId || `new:${projectId}`
    let requestId = navigation.current
    try {
      let target = chat
      if (!target) {
        const savedProjectId = await ensureProject(projectId)
        target = await api.createChat({ title: newTitle || content.split('\n')[0].slice(0, 80), projectId: savedProjectId || null, model, permissionMode: permission }); applyChat(target)
        if (requestId === navigation.current) { remember(`draft:${target.id}`, draft); selectChat(target, true); requestId = navigation.current }
      }
      applyChat(await api.send(target.id, content))
      if (stored(`draft:${draftKey}`) === draft) remember(`draft:${draftKey}`, '')
      if (stored(`draft:${target.id}`) === draft) remember(`draft:${target.id}`, '')
      if (requestId === navigation.current) setDraft('')
    } catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) } finally { setBusy(false); if (requestId === navigation.current) composer.current?.focus() }
  }
  async function setOption(field: 'projectId' | 'model' | 'permissionMode', value: string) {
    setError('')
    if (chat) {
      if (busy) return
      const requestId = navigation.current
      setBusy(true)
      try { const selected = field === 'projectId' ? await ensureProject(value) : value; applyChat(await api.updateChat(chat.id, { [field]: selected || null })) } catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) } finally { setBusy(false) }
    }
    else if (field === 'projectId') { remember(`draft:new:${projectId}`, draft); navigate({ view: 'new', projectId: value || null }, true) }
    else if (field === 'model') setModel(value as Model)
    else setPermission(value as PermissionMode)
  }
  async function copy(text: string, label = 'Copied') { try { await navigator.clipboard.writeText(text); setToast(label) } catch { setError('Clipboard access failed. Select and copy the text manually.') } }
  function openRename(target?: RenameTarget, title = currentTitle) {
    setRenameTarget(target ?? (view === 'native' && native?.sessionId ? { kind: 'native', id: native.sessionId } : chat ? { kind: 'chat', id: chat.id } : { kind: 'draft' }))
    setTitleInput(title === 'New conversation' ? '' : title); setError(''); setModal('rename')
  }
  async function saveRename(event: FormEvent) {
    event.preventDefault(); if (preview || busy || !titleInput.trim()) return
    const requestId = navigation.current
    setBusy(true); setError('')
    try {
      if (renameTarget.kind === 'native') {
        const result = await api.renameNative(renameTarget.id, titleInput.trim())
        if (requestId === navigation.current) setNative(current => current?.sessionId === result.session.sessionId ? result.session : current)
        if (result.chat) applyChat(result.chat)
        setNativeSessions(previous => previous.map(item => item.sessionId === result.session.sessionId ? result.session : item))
      }
      else if (renameTarget.kind === 'chat') applyChat(await api.updateChat(renameTarget.id, { title: titleInput.trim() }))
      else setNewTitle(titleInput.trim())
      if (requestId === navigation.current) { setModal(null); setToast('Conversation renamed') }
    } catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  async function addProject(event: FormEvent) {
    event.preventDefault(); if (busy || preview) return
    const requestId = navigation.current
    setBusy(true); setError('')
    try {
      const project = await api.addProject(projectName.trim() || projectPath.replace(/\/$/, '').split('/').pop() || 'Project', projectPath.trim())
      setState(previous => ({ ...previous, projects: [...previous.projects.filter(item => item.id !== project.id), project] }))
      if (requestId === navigation.current) {
        setProjectId(project.id); remember('project', project.id)
        if (route.view === 'new') navigate({ view: 'new', projectId: project.id }, true)
        setModal(null); setToast('Project added')
      }
    } catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  async function removeChat() {
    if (!chat || preview || busy) return
    const requestId = navigation.current
    setBusy(true)
    try {
      await api.removeChat(chat.id)
      setState(previous => ({ ...previous, chats: previous.chats.filter(item => item.id !== chat.id) }))
      if (requestId === navigation.current) { setModal(null); newChat() }
    } catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  async function stopChat() {
    if (!chat || preview) return
    const requestId = navigation.current
    try { applyChat(await api.stop(chat.id)) }
    catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) }
  }
  async function syncChat() {
    if (!chat?.sessionId || preview || busy || running || !connected || syncingChatId) return
    const requestId = navigation.current
    const chatId = chat.id
    setSyncingChatId(chatId); setError('')
    try {
      // SSE owns transcript updates; a delayed POST response must not replace
      // a newer snapshot that arrived while this request was in flight.
      const result = await api.syncChat(chatId)
      if (requestId === navigation.current) {
        if (result.sync?.status === 'synced') setToast('Claude history synced')
        else setError(result.sync?.error || 'Claude history could not be synced. Your saved messages were kept.')
      }
    } catch (reason) { if (requestId === navigation.current) setError(errorMessage(reason)) }
    finally { setSyncingChatId(current => current === chatId ? null : current) }
  }
  function exportChat() {
    const text = `# ${currentTitle}\n\n${messages.map(message => `## ${message.role === 'user' ? 'You' : 'Claude'}\n\n${message.content}`).join('\n\n')}`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${currentTitle.replace(/[^\p{L}\p{N}\s_-]/gu, '').slice(0, 80) || 'conversation'}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function changeVisibility(path: string, hidden: boolean) {
    const next = changeRepositoryVisibility(hiddenRepositories, path, hidden)
    setHiddenRepositories(next); remember('hidden-repositories', JSON.stringify([...next]))
    if (hidden) setToast('Repository hidden from sidebar. Restore it under Hidden repositories.')
  }
  function saveRepositoryPreferences(next: RepositoryPreferences) {
    if (preview) return
    setRepositoryPreferences(next); remember('repository-preferences', serializeRepositoryPreferences(next))
  }
  function projectRow(repo: WorkspaceRepository) {
    const preferencePath = repo.path.replace(/\/+$/, '') || '/'
    const currentThread = repo.chats.some(item => item.id === selectedId) || repo.sessions.some(item => item.sessionId === nativeRouteId)
    const isCollapsed = !(projectExpansion[repo.id] ?? (currentThread || (preview ? repo.id === 'mother-oracle' : repositoryRows.indexOf(repo) < 3)))
    const threadSort = repositoryPreferences.threadSorts?.get(preferencePath) ?? 'updated'
    const allThreads = sortRepositoryThreads(repo.chats, repo.sessions, threadSort)
    const threads = expandedThreads.has(repo.id) || currentThread ? allThreads : allThreads.slice(0, 5)
    return <div className="project-group" key={repo.id} data-repository-path={repo.path}>
      <div className="project-heading">
        <button className="project-row" title={repo.path} aria-expanded={!isCollapsed} onClick={() => setProjectExpansion(previous => ({ ...previous, [repo.id]: isCollapsed }))}><Icon name="chevron" size={13} className={!isCollapsed ? 'turn-down' : ''} /><Icon name="folder" /><span className="truncate">{repo.name}</span><span className="repo-thread-count">{repo.chats.length + repo.sessions.length || ''}</span></button>
        {!preview && <RepositoryActions name={repo.name} alias={repositoryPreferences.names.get(preferencePath)} favorite={repositoryPreferences.favorites.has(preferencePath)} threadSort={threadSort}
          onFavorite={() => saveRepositoryPreferences(setRepositoryFavorite(repositoryPreferences, repo.path, !repositoryPreferences.favorites.has(preferencePath)))}
          onThreadSort={sort => { saveRepositoryPreferences(setRepositoryThreadSort(repositoryPreferences, repo.path, sort)); setToast(sort === 'updated' ? 'Threads sorted by latest update' : 'Threads sorted by name') }}
          onRename={name => { saveRepositoryPreferences(setRepositoryName(repositoryPreferences, repo.path, name)); setToast(name.trim() ? 'Repository label saved in this browser' : 'Repository label reset') }}
          onHide={() => changeVisibility(repo.path, true)} />}
      </div>
      {!isCollapsed && <>
        {threads.map(thread => thread.kind === 'chat' ? <SidebarThread key={`chat:${thread.item.id}`} title={thread.item.title} selected={chat?.id === thread.item.id} nested running={thread.item.status === 'running'} onSelect={() => selectChat(thread.item)} onRename={preview ? undefined : () => openRename({ kind: 'chat', id: thread.item.id }, thread.item.title)} renameDisabled={busy || thread.item.status === 'running'} /> : <SidebarThread key={`native:${thread.item.sessionId || thread.item.id}`} nativeId={thread.item.sessionId || undefined} title={thread.item.name || 'Untitled thread'} selected={nativeRouteId === thread.item.sessionId} nested locked={thread.item.action !== 'resume'} onSelect={() => selectNative(thread.item)} onRename={preview || !thread.item.sessionId ? undefined : () => openRename({ kind: 'native', id: thread.item.sessionId! }, thread.item.name || '')} renameDisabled={busy || thread.item.action !== 'resume'} />)}
        {allThreads.length > threads.length && <button className="project-empty" onClick={() => setExpandedThreads(previous => new Set(previous).add(repo.id))}>Show {allThreads.length - threads.length} more threads</button>}
        <button className="project-empty" onClick={() => newChat(repo.id)}>{repo.chats.length || repo.sessions.length ? '+ New thread' : 'Start a conversation'}</button>
      </>}
    </div>
  }

  return <div className={`workspace ${sidebarHidden ? 'sidebar-hidden' : ''} ${preview ? 'preview-mode' : ''}`}>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation">
      <div className="brand-row"><button className="brand" onClick={() => newChat()}><ClaudeMark /><span>ARRA Claude Code</span></button><IconButton icon="search" label="Search conversations (⌘K)" onClick={() => { setSearch(''); setModal('search') }} /><span className="mobile-only"><IconButton icon="close" label="Close sidebar" onClick={() => setSidebarOpen(false)} /></span></div>
      <div className="primary-nav"><button className={`new-chat ${route.view === 'new' ? 'selected' : ''}`} aria-current={route.view === 'new' ? 'page' : undefined} onClick={() => newChat()}><Icon name="new" size={21} /><span>New chat</span><span className="shortcut">⇧⌘O</span></button>{!preview && <button className={`agents-nav ${view !== 'chat' ? 'selected' : ''}`} aria-current={view !== 'chat' ? 'page' : undefined} onClick={showAgents}><Icon name="agents" size={20} /><span>Your chats</span><Icon name="chevron" size={14} /></button>}</div>
      <nav className="sidebar-scroll"><section className="projects"><div className="section-label"><span>Projects</span><span className="repository-actions">{!preview && <IconButton icon="refresh" label="Refresh repositories and threads" onClick={() => { void refreshRepositories(); void refreshNative() }} disabled={repositoriesLoading || nativeListLoading} />}<IconButton icon="plus" label="Add project" onClick={() => { setProjectName(''); setProjectPath(health?.cwd || ''); setError(''); setModal('project') }} disabled={preview} /></span></div>
          {!preview && <><p className="repository-source" title={repositoryInventory.root || undefined}>{repositoriesLoading ? 'Finding repositories…' : repositoryInventory.root ? 'ghq · recent filesystem activity' : 'Your local folders'}</p><input className="repository-filter" aria-label="Find a repository" placeholder="Find a repository…" value={repositorySearch} onChange={event => setRepositorySearch(event.target.value)} />{repositoryInventory.warning && <p className="sidebar-empty" role="status">{repositoryInventory.warning}</p>}{nativeError && <p className="sidebar-empty" role="status">Threads unavailable. Use refresh to retry.</p>}</>}
          {!repositorySearch && favoriteRepositories.length > 0 ? <><h3 className="mt-4 mb-1 flex items-center gap-2 px-2 text-xs font-medium text-[var(--color-muted)]"><Icon name="star" size={12} />Favorites</h3>{favoriteRepositories.map(projectRow)}{recentRepositories.length > 0 && <h3 className="mt-5 mb-1 px-2 text-xs font-medium text-[var(--color-muted)]">Recent repositories</h3>}{recentRepositories.slice(0, repositoryLimit).map(projectRow)}</> : visibleRepositories.map(projectRow)}{!loaded && <div className="skeleton-lines" aria-label="Loading projects"><i /><i /><i /></div>}
          {!repositorySearch && recentRepositories.length > repositoryLimit && <button className="repository-more" onClick={() => setRepositoryLimit(limit => limit + 20)}>Show more repositories ({recentRepositories.length - repositoryLimit})</button>}
          {repositorySearch && !matchingRepositories.length && <p className="sidebar-empty">No visible repositories match.</p>}
          {!preview && hiddenRepositories.size > 0 && <details className="hidden-repositories"><summary>Hidden repositories ({hiddenRepositories.size})</summary><p>Hidden here, not deleted. Files and threads are untouched.</p>{[...hiddenRepositories].map(path => <div className="hidden-repository-row" key={path}><span className="truncate" title={path}>{repositoryRows.find(repo => repo.path === path)?.name || path.split('/').pop() || path}</span><button className="subtle-button" aria-label={`Restore ${path.split('/').pop()} to sidebar`} onClick={() => changeVisibility(path, false)}>Restore</button></div>)}</details>}
        </section>
        <section className="recents"><div className="section-label"><span>Picked up here</span></div>{state.chats.map(item => <SidebarThread key={item.id} title={item.title} selected={chat?.id === item.id && !preview} running={item.status === 'running'} onSelect={() => selectChat(item)} onRename={preview ? undefined : () => openRename({ kind: 'chat', id: item.id }, item.title)} renameDisabled={busy || item.status === 'running'} />)}{loaded && !state.chats.length && <p className="sidebar-empty">A fresh start. Your next chat goes here.<button onClick={showAgents}>Find your other chats <Icon name="chevron" size={12} /></button></p>}</section>
      </nav>
      <footer className="sidebar-footer"><div><span className={`status-dot ${connected ? '' : 'offline'}`} /><span title={backendTarget(window.location.href).origin}>{connected ? isLoopback(new URL(backendTarget(window.location.href).origin).hostname) ? 'Local on this Mac' : 'Backend connected' : 'Reconnecting…'}</span><IconButton icon="settings" label="Workspace settings" onClick={() => { setError(''); setModal('settings') }} /></div>{preview ? <a href={workspaceLink(window.location.href, false)} className="preview-caption">Design preview · example conversations</a> : <span className="local-caption">Conversations stay on your chosen backend</span>}</footer>
    </aside>

    <main className="main-pane"><header className="topbar"><button className="icon-button sidebar-toggle" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 760) setSidebarOpen(!sidebarOpen); else setSidebarHidden(!sidebarHidden) }}><Icon name="panel" /></button>{view === 'native' ? <IconButton icon="back" label="Back to Claude agents" onClick={showAgents} /> : <Icon name={view === 'agents' ? 'agents' : 'folder'} size={22} />}<h1 className="topbar-title">{currentTitle}</h1><div className="topbar-actions"><Appearance />{view !== 'agents' && <IconButton icon="info" label="Session details" onClick={() => setDetailsOpen(!detailsOpen)} active={detailsOpen} />}</div></header>
      {error && error !== connectionIssue && !modal && <div className="error-banner" role="alert"><span>{error}</span><IconButton icon="close" label="Dismiss error" onClick={() => setError('')} /></div>}
      {!preview && loaded && (!connected || connectionIssue) && <div className="warning-banner flex flex-wrap items-center justify-between gap-x-4 gap-y-2" role="status"><span>{connectionIssue ? 'This browser could not reach the backend.' : 'Live updates are disconnected.'}</span><button type="button" className="subtle-button shrink-0 text-[13px]" onClick={() => setConnectionHelpOpen(true)}>Connection help</button></div>}
      {!preview && health?.allowAnyOrigin && <div className="warning-banner" role="alert">Unsafe development mode: every website origin can access this backend, read conversations, and run Claude commands. Remove CC_CHAT_ALLOW_ANY_ORIGIN to secure it.</div>}
      {!preview && loaded && health && !health.claudeAvailable && <div className="warning-banner">Claude Code wasn’t found. Install it, run <code>claude auth login</code>, then restart this app.</div>}
      <div className="main-body">
        <div className="content-pane">
          {view === 'agents' ? <section className="agents-view">
            <div className="agents-heading"><div><h2>Pick up<br /><span>a thread.</span></h2><p>Your ideas didn’t go anywhere. <strong>{nativeSessions.length ? `${nativeSessions.length} real chats, right here.` : 'Let’s find your chats.'}</strong></p></div><button className="inbox-new" aria-label="Start a new chat" onClick={() => newChat()}><Icon name="plus" size={21} />Start something</button></div>
            <div className="inbox-controls"><label className="search-input"><Icon name="search" /><input value={filter} onChange={event => navigate({ view: 'agents', tab: sessionTab, search: event.target.value }, true)} placeholder="Find your people, projects, ideas…" aria-label="Filter Claude sessions" /></label><button className="inbox-refresh icon-button" title="Refresh real Claude sessions" aria-label="Refresh Claude sessions" onClick={() => void refreshNative()} disabled={nativeListLoading}><Icon name="refresh" /></button></div>
            <div className="inbox-tabs" role="group" aria-label="Session source">{([{ id: 'agents', label: 'Agents' }, { id: 'terminals', label: 'Terminals' }, { id: 'saved', label: 'Saved' }] as const).map(tab => <button key={tab.id} aria-pressed={sessionTab === tab.id} onClick={() => navigate({ view: 'agents', tab: tab.id, search: filter })}>{tab.label}<span>{sessionsForTab(nativeSessions, tab.id).length}</span></button>)}</div>
            <p className="session-source-note">{sessionTab === 'agents' ? 'Background agents · grouped like Claude agents' : sessionTab === 'terminals' ? 'Open Claude terminal sessions' : 'Saved conversations from the Claude SDK'} · Newest started first</p>
            {nativeError && <p className="inline-error" role="alert">{nativeError}</p>}{nativeListLoading && !nativeSessions.length && <div className="skeleton-lines"><i /><i /><i /></div>}
            {sessionGroups[sessionTab].map(group => {
              const rows = visibleSessions.filter(item => sessionGroup(item) === group)
              return rows.length ? <section className="native-group" key={group}><h3>{group === 'Saved conversations' ? 'Waiting for your next idea' : group}<span className="count">{rows.length}</span></h3>{rows.map((item, index) => {
                const project = item.cwd.split('/').filter(Boolean).pop() || 'Local workspace'
                const initials = project.split(/[-_ ]/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
                const color = [...project].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5
                const status = item.state === 'failed' ? 'Failed' : item.state === 'stopped' ? 'Stopped' : group === 'Needs input' ? 'Needs you' : item.kind === 'saved' ? 'Saved' : group
                const reference = (item.id || item.sessionId || '').slice(0, 8)
                return <button className="native-row" data-session-id={item.sessionId || item.id || undefined} key={`${item.sessionId}-${item.id}-${index}`} onClick={() => void selectNative(item)} title={`${item.name || 'Untitled chat'} · ${item.cwd}`}><span className={`project-avatar avatar-${color}`} aria-hidden="true">{initials}</span><span className="native-row-content"><strong>{item.name || project}</strong><span>{project}{reference && <> · <code>{reference}</code></>}</span></span><span className={`native-row-status status-${group === 'Needs input' ? 'needs' : group === 'Working' ? 'working' : 'quiet'}`} title={item.waitingFor || item.status || item.state || status}>{status}</span><Icon name="chevron" size={15} /></button>
              })}</section> : null
            })}
            {!nativeListLoading && !nativeError && !visibleSessions.length && <div className="list-empty"><Icon name="search" size={26} /><h3>{filter ? 'Nothing here just yet' : 'Your next idea starts here'}</h3><p>{filter ? 'Try another filter or a different name.' : 'Start a new chat, or open Claude Code in a terminal.'}</p></div>}
            <p className="agents-note">Real sessions from your Mac. Looking to message another agent? Ask Claude to <code>/list-agents</code> first.</p>
          </section> : <>
            <div className="conversation-scroll-wrap"><div className="conversation-scroll" ref={scroller} onScroll={event => { const node = event.currentTarget; const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 100; nearBottom.current = atBottom; setShowJumpToBottom(!atBottom && messages.length > 0) }}>
              {selectedId && !chat ? <div className="list-empty"><h2>{loaded ? 'Conversation not found' : 'Loading conversation…'}</h2>{loaded && <><p>This link is not in your local workspace. Pick a thread from the sidebar or start a new chat.</p><button className="subtle-button" onClick={() => newChat()}>New chat</button><button className="subtle-button" onClick={showAgents}>Go to Your chats</button></>}</div> : messages.length ? <div className="conversation" aria-label="Conversation">{conversationItems.map(item => {
                if (item.type === 'activity') return <Fragment key={item.key}><Activity item={item} />{item.usageEntries?.map(entry => <UsageInfo key={entry.messageId} usage={entry.usage} />)}</Fragment>
                const message = item.message
                const toolOnly = Boolean(message.history?.blocks.length && message.history.blocks.every(block => block.type !== 'text'))
                return <article className={`message ${message.role === 'user' && !toolOnly ? 'user-message' : 'assistant-message'} ${toolOnly ? 'tool-only-message' : ''}`} key={item.key}>
                  <div className="message-body"><MessageBody message={message} />{message.status === 'streaming' && <div className="streaming-status" role="status"><span className="activity-dot" />{message.content ? 'Working…' : 'Claude is working…'}</div>}{message.status === 'error' && <p className="inline-error" role="alert">{message.error || 'Claude could not complete this turn. Send another message to retry.'}</p>}{message.status === 'interrupted' && <p className="message-note">Stopped · You can continue this conversation.</p>}</div>
                  {message.usage && <UsageInfo usage={message.usage} />}
                  {message.appOnly && <p className="mb-1 text-xs text-[var(--color-muted)]">Local failed attempt · not in Claude history</p>}{!toolOnly && <div className="message-meta">{!message.history && <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>}{message.content && <IconButton icon="copy" label="Copy message" onClick={() => void copy(message.content, 'Message copied')} />}</div>}
                </article>
              })}{latestAssistant && !latestAssistant.usage && <p className="usage-unavailable">{latestAssistant.status === 'streaming' ? 'Token usage will appear when this turn finishes.' : 'Token usage was not reported for this response.'}</p>}</div> : nativeLoading ? <div className="conversation"><div className="skeleton-lines"><i /><i /><i /></div></div> : <div className="empty-state"><ClaudeMark size={46} /><h2>{view === 'native' ? 'No messages to display' : 'What’s the move?'}</h2><p>{view === 'native' ? 'This session has no readable conversation messages yet.' : 'A wild idea, a tiny fix, or the next big thing.'}</p></div>}
              <HistoryLoadControls hasMore={nextHistory !== null} loading={historyLoading} pages={historyPages} notice={historyNotice} disabled={busy || running || !connected || preview} onMore={() => void loadHistory()} onAll={() => void loadHistory(true)} onStop={() => historyRequest.current?.abort()} />
            </div>{showJumpToBottom && <button type="button" className="jump-to-bottom" onClick={jumpToBottom}><Icon name="arrow" size={15} className="rotate-180" />Jump to bottom</button>}</div>
            {selectedId && !chat ? null : view === 'native' ? <div className="native-session-footer"><div><Icon name={native?.action === 'resume' ? 'message' : 'lock'} /><span><strong>{!native ? nativeLoading ? 'Loading Claude session…' : 'Session unavailable' : native.action === 'resume' ? 'Continue this conversation' : native.action === 'unavailable' ? 'This session is read-only' : 'This session is open in Claude Code'}</strong><small>{!native ? 'Return to Your chats to select another session.' : native.action === 'resume' ? 'Resume the same session in its original project folder.' : 'History is read-only here. Keep working in its terminal, or exit it before resuming here.'}</small></span></div><div className="native-footer-actions">{native?.terminalCommand && <button className="subtle-button" onClick={() => void copy(native.terminalCommand!, 'Terminal command copied')}><Icon name="copy" size={15} />Copy terminal command</button>}{native?.action === 'resume' && <button className="primary-button" onClick={() => void importNative()} disabled={busy}>{busy ? 'Opening…' : 'Resume here'}<Icon name="arrow" size={16} /></button>}</div></div> : <div className="composer-area">
              {chat?.sessionId && <TranscriptSyncStatus chat={chat} syncing={syncingChatId === chat.id} connected={connected} busy={busy || Boolean(syncingChatId && syncingChatId !== chat.id)} onSync={() => void syncChat()} />}
              {missingNewProject && <p className="composer-explainer" role="status">This project is no longer in your workspace. Choose a project or Local workspace below.</p>}
              {!messages.length && <p className="composer-explainer"><Icon name="info" size={14} />New chat creates a new Claude session.</p>}
              {chat?.historyUnavailable && <p className="composer-explainer">Earlier history is unavailable. New replies will be saved here.</p>}
              {importedHistoryPending && <p className="composer-explainer">Load all remaining history before continuing this imported session to keep its messages in order.</p>}
              <form className="composer" onSubmit={send}><div className="project-picker"><Icon name="folder" /><select aria-label="Conversation project" value={selectedProject?.id || (chat ? chat.projectId || '' : projectId)} onChange={event => void setOption('projectId', event.target.value)} disabled={Boolean(chat?.sessionId) || preview || running || busy}><option value="">Local workspace</option>{missingNewProject && <option value={projectId} disabled>Project unavailable</option>}{repositoryRows.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><Icon name="chevron" size={12} className="turn-down" /><span className="project-path" title={selectedProject?.path}>{chat?.sessionId ? 'Session project' : ''}</span></div>
                <div className="composer-input"><textarea ref={composer} value={draft} onChange={event => changeDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder={importedHistoryPending ? 'Load the remaining history before continuing…' : 'Got an idea? Let’s make it happen…'} aria-label="Message Claude" rows={2} disabled={preview || busy || importedHistoryPending} />
                  {draft.startsWith('/') && <p className="slash-hint"><code>/rename title</code> names this conversation · <code>/list-agents</code> asks Claude to discover peers</p>}
                  <div className="composer-toolbar"><IconButton icon="plus" label="Add project" onClick={() => { setProjectName(''); setProjectPath(health?.cwd || ''); setModal('project') }} disabled={preview || busy} /><label className={`permission-picker ${currentPermission === 'bypassPermissions' ? 'full-access' : ''}`} title={currentPermission === 'bypassPermissions' ? 'Full access bypasses Claude permission prompts. Only use with trusted projects.' : 'Claude default permissions; non-interactive requests cannot show approval dialogs.'}><Icon name={currentPermission === 'bypassPermissions' ? 'shield' : 'lock'} size={17} /><select aria-label="Permission mode" value={currentPermission} onChange={event => void setOption('permissionMode', event.target.value)} disabled={preview || running || busy}><option value="bypassPermissions">Full access</option><option value="default">Default permissions</option></select></label><div className="composer-spacer" /><label className="model-picker"><select aria-label="Claude model" value={currentModel} onChange={event => void setOption('model', event.target.value)} disabled={preview || running || busy}>{Object.entries(modelNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><Icon name="chevron" size={12} className="turn-down" /></label>{running ? <button type="button" className="send-button stop-button" aria-label="Stop Claude" onClick={() => void stopChat()}><Icon name="stop" size={16} /></button> : <button type="submit" className="send-button" aria-label="Send message" disabled={!preview && (!draft.trim() || busy || importedHistoryPending || missingNewProject || !connected)} title={preview ? 'Design preview only' : 'Send message (Enter)'}><Icon name="arrow" size={21} /></button>}</div>
                </div>
              </form><p className="composer-caption">{preview ? 'Claude Code · Runs locally' : running ? 'Claude is running in your project' : 'Claude Code · Runs locally'}{!preview && <span>Shift + Enter for a new line</span>}</p>
            </div>}
          </>}
        </div>
        {detailsOpen && view !== 'agents' && <aside className="session-panel" aria-label="Session details"><div className="panel-heading"><h2>Session details</h2><IconButton icon="close" label="Close session details" onClick={() => setDetailsOpen(false)} /></div><dl><dt>Project</dt><dd><Icon name="folder" />{view === 'native' ? native?.cwd.split('/').pop() : selectedProject?.name || 'Local workspace'}</dd><dt>Working directory</dt><dd className="path-value">{view === 'native' ? native?.cwd : selectedProject?.path || health?.cwd || 'Local workspace'}</dd><dt>Session</dt><dd className="path-value">{view === 'native' ? native?.sessionId : chat?.sessionId || 'Created on first message'}</dd><dt>Model</dt><dd>{view === 'native' ? 'From native session' : modelNames[currentModel]}</dd><dt>Permissions</dt><dd className={currentPermission === 'bypassPermissions' ? 'full-access' : ''}>{view === 'native' ? 'Managed by native session' : currentPermission === 'bypassPermissions' ? 'Full access' : 'Default permissions'}</dd></dl>{view !== 'native' && currentPermission === 'bypassPermissions' && <p className="panel-warning">Permission prompts are bypassed. Use only with projects you trust.</p>}<div className="panel-actions"><button className="subtle-button" onClick={() => openRename()} disabled={preview || running || busy || (view === 'native' && native?.action !== 'resume')}><Icon name="new" size={16} />Rename session</button><button className="subtle-button" onClick={exportChat} disabled={!messages.length}><Icon name="download" size={16} />Export conversation</button>{chat && <button className="subtle-button danger-text" onClick={() => setModal('remove')} disabled={preview || running}><Icon name="trash" size={16} />Remove from workspace</button>}</div></aside>}
      </div>
    </main>

    {connectionHelpOpen && !modal && <ConnectionHelp frontendOrigin={window.location.origin} origin={backendTarget(window.location.href).origin} local={isLoopback(new URL(backendTarget(window.location.href).origin).hostname)} issue={connectionIssue || 'The live event stream is disconnected.'} checking={checkingConnection} onRetry={() => void retryConnection()} onClose={() => setConnectionHelpOpen(false)} />}
    {modal && <Dialog title={modal === 'project' ? 'Add a project' : modal === 'search' ? 'Find a conversation' : modal === 'rename' ? 'Rename conversation' : modal === 'remove' ? 'Remove from workspace?' : 'Your local workspace'} onClose={() => { if (!busy) { setModal(null); setError('') } }} wide={modal === 'search'}>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {modal === 'project' && <form onSubmit={addProject}><p className="dialog-description">Claude will run in this folder and use its project instructions.</p><label className="field">Project name<input autoFocus value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="Optional — uses the folder name" maxLength={120} /></label><label className="field">Folder path<input value={projectPath} onChange={event => setProjectPath(event.target.value)} placeholder="/Users/you/Projects/my-project" required autoComplete="off" /></label><p className="field-help">Use the full path to an existing folder on this Mac.</p><div className="dialog-footer"><button type="button" className="subtle-button" onClick={() => setModal(null)} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy || preview}>{busy ? 'Adding…' : 'Add project'}</button></div></form>}
      {modal === 'rename' && <form onSubmit={saveRename}><p className="dialog-description">A name makes this session easier to find{renameTarget.kind !== 'draft' ? ' in Claude Code and this workspace' : ''}.</p><label className="field">Conversation name<input autoFocus value={titleInput} onChange={event => setTitleInput(event.target.value)} maxLength={200} required /></label><div className="dialog-footer"><button type="button" className="subtle-button" onClick={() => setModal(null)} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy || !titleInput.trim() || preview}>{busy ? 'Renaming…' : 'Save name'}</button></div></form>}
      {modal === 'search' && <><label className="search-input"><Icon name="search" /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search names and conversations" aria-label="Search saved conversations" /></label><div className="search-results">{state.chats.filter(item => `${item.title} ${item.messages.map(message => message.content).join(' ')}`.toLowerCase().includes(search.toLowerCase())).map(item => <button key={item.id} onClick={() => { selectChat(item); setModal(null) }}><Icon name="message" /><span><strong>{item.title}</strong><small>{state.projects.find(project => project.id === item.projectId)?.name || 'Local workspace'}</small></span><Icon name="chevron" size={14} /></button>)}{!state.chats.some(item => `${item.title} ${item.messages.map(message => message.content).join(' ')}`.toLowerCase().includes(search.toLowerCase())) && <p className="search-empty">No saved conversations match.</p>}</div><button className="subtle-button" onClick={() => { setModal(null); showAgents() }}><Icon name="agents" />Browse native Claude sessions</button></>}
      {modal === 'remove' && <><p className="dialog-description">Remove <strong>{chat?.title}</strong> from this app? Its native Claude Code conversation and project files will remain untouched.</p><div className="dialog-footer"><button className="subtle-button" onClick={() => setModal(null)} disabled={busy}>Keep conversation</button><button className="primary-button danger-button" onClick={() => void removeChat()} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</button></div></>}
      {modal === 'settings' && <div className="settings-content"><div className="connection-status"><span className={`status-dot ${health?.claudeAvailable ? '' : 'offline'}`} /><strong>{health?.claudeAvailable ? 'Claude Code connected' : preview ? 'Design preview' : 'Checking Claude Code'}</strong></div><p>{health?.claudeVersion || 'Uses the Claude Code CLI installed on this Mac.'}</p><dl><dt>Backend</dt><dd className="path-value">{backendTarget(window.location.href).origin}</dd><dt>Workspace folder</dt><dd className="path-value">{health?.cwd || 'Local workspace'}</dd><dt>Saved data</dt><dd>Projects and conversations stay on this Mac. Native history and names use the official Claude Agent SDK.</dd></dl><p className="panel-warning">Full access uses <code>--dangerously-skip-permissions</code>. Claude can modify files and run commands without asking. Use trusted projects.</p><p>Default permissions do not show interactive approval prompts in this headless interface. For those requests, use Claude Code in a terminal.</p><div className="settings-links"><a href="https://code.claude.com/docs/en/cross-session-messaging" target="_blank" rel="noreferrer">Native agent messaging documentation <Icon name="chevron" size={13} /></a><a href={workspaceLink(window.location.href, true)}>View the approved design preview <Icon name="chevron" size={13} /></a></div><p className="field-help">An independent local interface. Not an official Anthropic or OpenAI application.</p></div>}
    </Dialog>}
    {toast && <div className="toast" role="status"><Icon name="check" size={16} />{toast}</div>}
  </div>
}
