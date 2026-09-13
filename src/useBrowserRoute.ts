import { useCallback, useEffect, useRef, useState } from 'react'
import { parseRoute, routeHash, type AppRoute } from './routes'

/** Small hash router: URLs work on refresh without server rewrite rules. */
export function useBrowserRoute(fallback: () => AppRoute) {
  const readRouteFromLocation = () => {
    const hash = window.location.hash
    if (hash) return parseRoute(hash)

    const pathname = window.location.pathname
    const pathWithSearch = `${pathname}${window.location.search}`
    if (pathname === '/sessions') return parseRoute('#/sessions')
    if (pathWithSearch.startsWith('/sessions/')) return parseRoute(`#${pathWithSearch}`)
    if (pathname === '/chats' || pathWithSearch.startsWith('/chats/')) return parseRoute(`#${pathWithSearch}`)
    if (pathWithSearch.startsWith('/new')) return parseRoute(`#${pathWithSearch}`)
    return parseRoute(routeHash(fallback()))
  }

  const [route, setRoute] = useState<AppRoute>(() => readRouteFromLocation())
  const current = useRef(route)
  const version = useRef(0)
  const navigate = useCallback((next: AppRoute, replace = false) => {
    const hash = routeHash(next)
    if (hash === routeHash(current.current) && hash === window.location.hash) return
    window.history[replace ? 'replaceState' : 'pushState'](null, '', `${window.location.pathname}${window.location.search}${hash}`)
    current.current = parseRoute(hash)
    version.current += 1
    setRoute(current.current)
  }, [])

  useEffect(() => {
    const restore = () => {
      const next = window.location.hash ? parseRoute(window.location.hash) : readRouteFromLocation()
      const hash = routeHash(next)
      if (window.location.hash !== hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
      if (hash === routeHash(current.current)) return
      current.current = next
      version.current += 1
      setRoute(next)
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${routeHash(current.current)}`)
    window.addEventListener('popstate', restore)
    window.addEventListener('hashchange', restore)
    return () => {
      window.removeEventListener('popstate', restore)
      window.removeEventListener('hashchange', restore)
    }
  }, [])

  return { route, navigate, version }
}
