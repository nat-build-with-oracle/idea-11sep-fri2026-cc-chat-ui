export const DEFAULT_BACKEND = 'http://127.0.0.1:4318'
export const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname)

/** Select a local backend without accepting credentials, paths, or remote targets. */
export function backendTarget(href: string) {
  const page = new URL(href)
  const hosted = !isLoopback(page.hostname)
  const raw = page.searchParams.get('host')
  if (raw === null && !hosted) return { base: '', origin: page.origin, hosted, explicit: false }
  const value = raw === null ? DEFAULT_BACKEND : raw.trim()
  if (!value || /[\s\\]/.test(value)) throw new Error('Use a local address such as http://127.0.0.1:4318.')
  let target: URL
  try { target = new URL(value.includes('://') ? value : `http://${value}`) }
  catch { throw new Error('The backend address is not a valid local URL.') }
  if (!['http:', 'https:'].includes(target.protocol) || !isLoopback(target.hostname) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('Choose a loopback HTTP(S) origin only: localhost, 127.0.0.1, or [::1], with an optional port. No paths or credentials.')
  }
  return { base: target.origin === page.origin ? '' : target.origin, origin: target.origin, hosted, explicit: raw !== null }
}

export function backendApiUrl(href: string, path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path')
  return `${backendTarget(href).base}/api${path}`
}

/** Keep drafts/selection isolated when a hosted UI switches between local ports. */
export function workspaceStorageKey(href: string, key: string) {
  const target = backendTarget(href)
  return target.base ? `cc:backend:${encodeURIComponent(target.origin)}:${key}` : `cc:${key}`
}

export function workspaceLink(href: string, preview: boolean) {
  const url = new URL(href)
  if (preview) url.searchParams.set('preview', 'oracle')
  else url.searchParams.delete('preview')
  url.hash = preview ? '' : '#/new'
  return `${url.pathname}${url.search}${url.hash}`
}
