import { useState, type FormEvent, type ReactNode } from 'react'
import { backendTarget, DEFAULT_BACKEND } from './backend-target'
import { ClaudeMark } from './Icon'

export default function BackendConnection({ children }: { children: ReactNode }) {
  const href = window.location.href
  let target: ReturnType<typeof backendTarget> | undefined
  let invalid = ''
  try { target = backendTarget(href) } catch (error) { invalid = (error as Error).message }
  const preview = new URL(href).searchParams.get('preview') === 'oracle'
  const [ready, setReady] = useState(() => {
    if (preview || (target && !target.base)) return true
    try { return Boolean(target && sessionStorage.getItem(`cc:connected:${target.origin}`)) } catch { return false }
  })
  const [address, setAddress] = useState(target?.origin || new URL(href).searchParams.get('host') || DEFAULT_BACKEND)
  const [error, setError] = useState(invalid)
  function connect(event: FormEvent) {
    event.preventDefault()
    try {
      const url = new URL(href)
      url.searchParams.set('host', address)
      const next = backendTarget(url.href)
      url.searchParams.set('host', next.origin)
      try { sessionStorage.setItem(`cc:connected:${next.origin}`, 'yes') } catch { /* Connect still works without session storage. */ }
      // A full navigation deliberately unmounts old state when switching hosts.
      if (target?.origin !== next.origin || !target.explicit) window.location.assign(url.href)
      else { setError(''); setReady(true) }
    } catch (reason) { setError((reason as Error).message) }
  }
  if (ready && target) return children
  return <main className="backend-connect">
    <div className="backend-connect-content">
      <ClaudeMark /><h1>Your Claude. Your backend.</h1>
      <p>The interface is hosted on Cloudflare. Conversations, files, and Claude execution stay on the backend you choose.</p>
      <form onSubmit={connect}>
        <label htmlFor="backend-address">Backend address</label>
        <input id="backend-address" value={address} onChange={event => setAddress(event.target.value)} placeholder={DEFAULT_BACKEND} spellCheck={false} autoCapitalize="off" required />
        {error && <p className="panel-warning" role="alert">{error}</p>}
        <button className="primary-button" type="submit">Connect to backend</button>
      </form>
      <details><summary>Start the backend</summary><p>In the app repository, run:</p><pre><code>{`CC_CHAT_FRONTEND_ORIGIN=${JSON.stringify(window.location.origin)} npm start`}</code></pre></details>
      <p className="field-help">Localhost points to this device. For another machine, use its reachable HTTPS address. Your browser may require local-network permission or block insecure HTTP connections.</p>
      <p className="field-help">Only connect to backends you trust. Protect remote backends with HTTPS and authentication; a shared or public backend can expose conversations and execute commands. This app does not add a tunnel or authentication to your backend.</p>
    </div>
  </main>
}
