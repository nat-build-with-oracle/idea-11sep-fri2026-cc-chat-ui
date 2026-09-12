export interface NativeSessionRefreshClock {
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
}

export interface NativeSessionRefreshDocument {
  readonly visibilityState: DocumentVisibilityState
  addEventListener: (type: 'visibilitychange', listener: () => void) => void
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void
}

export interface NativeSessionRefreshWindow {
  addEventListener: (type: 'focus', listener: () => void) => void
  removeEventListener: (type: 'focus', listener: () => void) => void
}

export interface NativeSessionRefreshOptions {
  refresh: () => Promise<void>
  intervalMs?: number
  maxBackoffMs?: number
  clock?: NativeSessionRefreshClock
  documentTarget?: NativeSessionRefreshDocument
  windowTarget?: NativeSessionRefreshWindow
}

const defaultClock: NativeSessionRefreshClock = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: timer => clearTimeout(timer),
}

export function startNativeSessionRefresh({
  refresh,
  intervalMs = 5_000,
  maxBackoffMs = 30_000,
  clock = defaultClock,
  documentTarget = typeof document === 'undefined' ? undefined : document,
  windowTarget = typeof window === 'undefined' ? undefined : window,
}: NativeSessionRefreshOptions) {
  let alive = true
  let refreshing = false
  let pending = false
  let failureCount = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const isVisible = () => documentTarget?.visibilityState !== 'hidden'

  const cancelTimer = () => {
    if (timer === undefined) return
    clock.clearTimeout(timer)
    timer = undefined
  }

  const schedule = (delay: number) => {
    if (!alive || !isVisible()) return
    cancelTimer()
    timer = clock.setTimeout(() => {
      timer = undefined
      requestRefresh()
    }, delay)
  }

  const requestRefresh = () => {
    if (!alive || !isVisible()) return
    cancelTimer()
    if (refreshing) {
      pending = true
      return
    }

    refreshing = true
    void refresh().then(() => {
      failureCount = 0
    }).catch(() => {
      failureCount += 1
    }).finally(() => {
      refreshing = false
      if (!alive || !isVisible()) return
      if (pending) {
        pending = false
        requestRefresh()
        return
      }
      const delay = failureCount === 0
        ? intervalMs
        : Math.min(intervalMs * (2 ** failureCount), maxBackoffMs)
      schedule(delay)
    })
  }

  const onFocus = () => requestRefresh()
  const onVisibilityChange = () => {
    if (!isVisible()) {
      pending = false
      cancelTimer()
      return
    }
    requestRefresh()
  }

  documentTarget?.addEventListener('visibilitychange', onVisibilityChange)
  windowTarget?.addEventListener('focus', onFocus)
  requestRefresh()

  return () => {
    if (!alive) return
    alive = false
    pending = false
    cancelTimer()
    documentTarget?.removeEventListener('visibilitychange', onVisibilityChange)
    windowTarget?.removeEventListener('focus', onFocus)
  }
}
