export interface Repository { id: string; name: string; path: string; modifiedAt: number }
export interface RepositoryInventory { root: string | null; repositories: Repository[]; warning?: string }
export interface Project { id: string; name: string; path: string; canonicalPath?: string; createdAt: string }
export interface Tool { id: string; name: string; input: unknown; status: 'running' | 'complete' }
export interface Usage {
  inputTokens: number; outputTokens: number;
  cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUsd?: number;
  scope?: 'allModels' | 'mainAgent' | 'apiMessage';
}
export interface Message {
  id: string; role: 'user' | 'assistant'; content: string; createdAt: string;
  nativeSourceIds?: string[]; appOnly?: boolean;
  history?: { sourceUuid: string; parentToolUseId?: string | null; blocks: HistoryBlock[] };
  status?: 'streaming' | 'complete' | 'error' | 'interrupted'; tools?: Tool[]; error?: string;
  usage?: Usage;
}
export type Model = string
export type PermissionMode = 'bypassPermissions' | 'default'
export interface ChatSync {
  status: 'synced' | 'error'; checkedAt: string;
  sourceHash?: string; messageCount?: number; error?: string;
}
export interface Chat {
  id: string; title: string; projectId: string | null; sessionId: string | null;
  model: Model; provider?: string; permissionMode: PermissionMode; createdAt: string; updatedAt: string;
  messages: Message[]; status: 'idle' | 'running';
  sync?: ChatSync;
  nativeImported?: boolean; historyUnavailable?: boolean; historyTruncated?: boolean; historyNextOffset?: number | null;
}
export interface SerializedRepositoryPreferences { favorites?: string[]; names?: Record<string, string>; threadSorts?: Record<string, 'updated' | 'name'> }
export interface AppState { projects: Project[]; chats: Chat[]; repositoryPreferences?: SerializedRepositoryPreferences }
export interface Health { ok: boolean; allowAnyOrigin?: boolean; claudeAvailable: boolean; claudeVersion: string | null; cwd: string; chatModels?: string[]; sessionNaming?: { summaryModels: string[]; namingModel: string } }
export interface SessionNameTarget { kind: 'chat' | 'native'; id: string }
export interface SessionNameCandidate { target: SessionNameTarget; title: string }
export interface SessionNameResult { summary: string; suggestions: string[]; summaryModel: string; namingModel: string; truncated: boolean; messageCount: number }

export type HistoryBlock = { type: 'text'; text: string } | { type: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'complete' } | { type: 'toolResult'; toolUseId: string; content: unknown; isError?: boolean }
export interface NativeSession {
  id: string | null; sessionId: string | null; cwd: string; canonicalPath?: string; kind: 'saved' | 'interactive' | 'background';
  name: string | null; pid: number | null; startedAt: number | null; updatedAt?: number | null; state: string | null; status: string | null;
  waitingFor: string | null; action: 'openTerminal' | 'resumeAfterExit' | 'resume' | 'unavailable'; terminalCommand: string | null;
  existingTerminal?: { sessionName: string; target: string; paneId: string; attachCommand: string };
  readOnlyReason?: string;
}
export interface HistoryPage { messages: Message[]; nextOffset: number | null }
