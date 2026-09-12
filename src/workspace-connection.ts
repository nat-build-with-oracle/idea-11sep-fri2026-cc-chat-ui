import { api, subscribe } from './api.ts'
import type { AppState, Health } from './types.ts'

export interface WorkspaceConnectionCallbacks {
  onState: (state: AppState) => void
  onHealth: (health: Health) => void
  onConnection: (connected: boolean) => void
  onIssue: (issue: Error) => void
  onRecovered: () => void
}

export interface WorkspaceConnectionSource {
  state: () => Promise<AppState>
  health: () => Promise<Health>
  subscribe: (
    onState: (state: AppState) => void,
    onConnection: (connected: boolean) => void,
  ) => () => void
}

const defaultSource: WorkspaceConnectionSource = {
  state: api.state,
  health: api.health,
  subscribe,
}

export function startWorkspaceConnection(
  callbacks: WorkspaceConnectionCallbacks,
  source: WorkspaceConnectionSource = defaultSource,
) {
  let alive = true
  let streamStateSeen = false
  let recovered = false
  let connection: boolean | undefined

  const reportConnection = (next: boolean) => {
    if (!alive || connection === next) return
    connection = next
    callbacks.onConnection(next)
  }
  const reportRecovery = () => {
    if (!alive || recovered) return
    recovered = true
    callbacks.onRecovered()
  }

  reportConnection(false)

  void source.state().then(state => {
    if (!alive || streamStateSeen) return
    callbacks.onState(state)
    reportRecovery()
  }).catch(reason => {
    if (!alive || streamStateSeen) return
    callbacks.onIssue(reason instanceof Error ? reason : new Error(String(reason)))
  })

  void source.health().then(health => {
    if (alive) callbacks.onHealth(health)
  }).catch(() => {})

  const close = source.subscribe(state => {
    if (!alive) return
    streamStateSeen = true
    callbacks.onState(state)
    reportRecovery()
  }, reportConnection)

  return () => {
    if (!alive) return
    alive = false
    close()
  }
}
