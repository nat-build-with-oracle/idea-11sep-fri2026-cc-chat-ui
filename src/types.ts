export interface Project { id: string; name: string; path: string; createdAt: string }
export interface Tool { id: string; name: string; input: unknown; status: 'running' | 'complete' }
export interface Usage {
  inputTokens: number; outputTokens: number;
  cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUsd?: number;
  scope?: 'allModels' | 'mainAgent' | 'apiMessage';
}
export interface Message {
  id: string; role: 'user' | 'assistant'; content: string; createdAt: string;
  history?: { sourceUuid: string; parentToolUseId?: string | null; blocks: HistoryBlock[] };
  status?: 'streaming' | 'complete' | 'error' | 'interrupted'; tools?: Tool[]; error?: string;
  usage?: Usage;
}
export type Model = 'sonnet' | 'opus' | 'haiku'
export type PermissionMode = 'bypassPermissions' | 'default'
export interface Chat {
  id: string; title: string; projectId: string | null; sessionId: string | null;
  model: Model; permissionMode: PermissionMode; createdAt: string; updatedAt: string;
  messages: Message[]; status: 'idle' | 'running';
  nativeImported?: boolean; historyUnavailable?: boolean; historyTruncated?: boolean; historyNextOffset?: number | null;
}
export interface AppState { projects: Project[]; chats: Chat[] }
export interface Health { ok: boolean; claudeAvailable: boolean; claudeVersion: string | null; cwd: string }

export type HistoryBlock = { type: 'text'; text: string } | { type: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'complete' } | { type: 'toolResult'; toolUseId: string; content: unknown; isError?: boolean }
export interface NativeSession {
  id: string | null; sessionId: string | null; cwd: string; kind: 'saved' | 'interactive' | 'background';
  name: string | null; pid: number | null; startedAt: number | null; state: string | null; status: string | null;
  waitingFor: string | null; action: 'openTerminal' | 'resumeAfterExit' | 'resume' | 'unavailable'; terminalCommand: string | null;
}
export interface HistoryPage { messages: Message[]; nextOffset: number | null }
