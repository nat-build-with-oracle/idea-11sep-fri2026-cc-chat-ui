import Dialog from './Dialog'

export default function ConnectionHelp({ origin, frontendOrigin, local, issue, checking, onRetry, onClose }: {
  origin: string
  frontendOrigin: string
  local: boolean
  issue: string
  checking: boolean
  onRetry: () => void
  onClose: () => void
}) {
  return <Dialog title={local ? 'Connect to Claude on your Mac' : 'Connect to your backend'} onClose={onClose}>
    <div className="connection-help [&_p]:text-sm [&_p]:leading-[1.7] [&_strong]:wrap-anywhere">
      <p className="dialog-description">This browser could not connect to <strong>{origin}</strong>. A network error alone does not tell us whether permission, browser policy, or the backend is responsible.</p>
      {local ? <>
        <h3 className="mt-5 mb-2.5 text-base font-semibold">Allow this site to reach your Mac</h3>
        <ol className="mt-2.5 mb-4 list-decimal pl-6 [&>li]:my-2 [&>li]:pl-1.5 [&>li]:text-sm [&>li]:leading-[1.7]">
          <li>If the browser asks to access <strong>other apps and services on this device</strong>, choose <strong>Allow</strong> only if you trust this site and started the backend.</li>
          <li>Already blocked it? Open the site controls beside the address bar → <strong>Site settings</strong> → allow <strong>Local network access</strong> or device access, if available.</li>
          <li>Come back here and select <strong>Retry connection</strong>.</li>
        </ol>
        <p className="field-help">That prompt belongs to your browser. This app cannot grant this permission, force the prompt to appear, or bypass a browser policy.</p>
        <details className="my-3.5 [&>summary]:cursor-pointer [&>summary]:py-2.5 [&>summary]:text-sm [&>summary]:font-semibold [&>p]:my-2.5 [&>a]:text-[13px]"><summary>Comet / ERR_BLOCKED_BY_CLIENT</summary>
          <p>If DevTools reports <code>ERR_BLOCKED_BY_CLIENT</code>, a client-side component blocked the request. The error does not identify which one; changing backend CORS will not remove that block.</p>
          <p>First test Comet’s <strong>Settings → Privacy → Blocking</strong>. Add only <code className="wrap-anywhere">{frontendOrigin}</code> to <strong>Adblock exceptions</strong>, keep global blocking enabled, then reload. If it makes no difference, remove the exception.</p>
          <p>Next, check <strong>Settings → Extensions</strong> for privacy or content-blocking extensions. Test them one at a time and restore anything that was not responsible.</p>
          <p>Permissions are separate in each browser. In Comet, also check <strong>Settings → Privacy and Security → Site Settings</strong>. If it is managed by work or school, ask the administrator about local-network policy. If it still fails, use the working Chrome connection or open the local app below.</p>
          <p>Do not disable browser security globally. This app cannot read your DevTools error code or change Comet’s settings.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]"><a href="https://www.perplexity.ai/help-center/comet/en/articles/11734702-adblock" target="_blank" rel="noreferrer">Comet Adblock guide</a><a href="https://www.perplexity.ai/help-center/comet/en/articles/11629598-manage-site-permissions" target="_blank" rel="noreferrer">Site-permission guide</a></div>
        </details>
      </> : <p>Check that this HTTPS backend is reachable and that its CORS settings allow this frontend’s exact origin. For LAN or VPN addresses, also check your network and browser’s local-network policy. Selecting an address does not add a tunnel or authentication.</p>}
      <p className="panel-warning">Only connect to an interface and backend you trust. This connection can read conversations and run Claude commands with the permissions you choose.</p>
      <details className="my-3.5 [&>summary]:cursor-pointer [&>summary]:py-2.5 [&>summary]:text-sm [&>summary]:font-semibold [&>p]:my-2.5 [&>a]:text-[13px]"><summary>Connection details</summary><p>Confirm the backend is running. A permission change cannot start a stopped backend or fix a mismatched allowed origin.</p><pre className="rounded-lg bg-[var(--color-raised)] p-3 text-xs wrap-anywhere whitespace-pre-wrap">{issue}</pre></details>
      <div className="dialog-footer flex-wrap">
        {local && <a className="subtle-button no-underline" href={`${origin}/`} target="_blank" rel="noreferrer">Open local app</a>}
        <button type="button" className="primary-button" disabled={checking} onClick={onRetry}>{checking ? 'Checking…' : 'Retry connection'}</button>
      </div>
      <p className="field-help">Retry checks the backend and reconnects live updates. It never resends a message or starts a Claude run.</p>
    </div>
  </Dialog>
}
