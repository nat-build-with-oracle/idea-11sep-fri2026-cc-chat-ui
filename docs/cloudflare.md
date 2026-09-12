# Cloudflare frontend, local Mac backend

The public frontend is **https://cc-chat-ui.laris.workers.dev**.

Open it on the Mac running the backend:

**[Connect to this Mac](https://cc-chat-ui.laris.workers.dev/?host=http://127.0.0.1:4318)**

## Start locally

In this repository:

```sh
npm ci
CC_CHAT_FRONTEND_ORIGIN=https://cc-chat-ui.laris.workers.dev npm start
```

Keep that process running. For the Vite development frontend as well, use the same environment variable with `npm run dev`. Only run one backend against a data directory at a time.

Select **Connect to backend** on the hosted page. Chromium may ask for permission to access your local network; allow it for this site. This permission belongs to your browser, not the app. A denied permission, stopped backend, or mismatched allowed origin prevents connection. Safari compatibility is not yet browser-verified; the local frontend remains available as a fallback.

The backend binds only to `127.0.0.1:4318`. `?host=` selects the browser's own local backend—not the Cloudflare server's network. Bare `127.0.0.1:4318` and any explicit HTTP(S) backend origin are accepted, including LAN, VPN, and public hostnames. Other ports can target isolated local instances. Credentials, paths, query parameters, and tokens in the backend address are rejected. Selecting an address does not create a tunnel or make that backend reachable: use HTTPS for remote backends and configure that backend’s own CORS and authentication. The address remains in the URL through navigation, refresh, and preview links. Each new cross-origin backend requires an explicit Connect action; workspace state is not reused across backend origins. Hosted drafts, selections, and hidden repositories are scoped to the selected backend origin.

The default link opened on a phone points to the phone’s loopback, not your Mac. The bundled Node server still binds to loopback and validates its Host header. Remote addresses are useful for separately secured backends; choosing one does **not** expose this Mac server or add remote access.

## Deploy your own frontend

```sh
npm run deploy
```

The script builds with Vite and runs the pinned Wrangler CLI through `npx`; authenticate using `npx wrangler@4.130.0 login` if needed. Set `CLOUDFLARE_ACCOUNT_ID` when your login can access multiple accounts. Change `name` in `wrangler.jsonc` for your own Worker, then allow its exact HTTPS origin in `CC_CHAT_FRONTEND_ORIGIN` when starting the backend.

Only `dist/` is uploaded. There is no Worker API proxy, SSR, database, Claude SDK, transcript, or local state in the deployment. The configuration uses Workers Static Assets with no custom `main` or `run_worker_first`. [Cloudflare documents static-asset requests as free and unlimited](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/); it does not make Claude model usage free.

## Trust boundary

- Your browser downloads the UI from Cloudflare and talks directly to the local API for REST and SSE streaming.
- By default, the backend validates a loopback Host, and only the exact opted-in HTTPS frontend origin gets cross-origin access. Unknown origins cannot read or mutate the API. Credentialed CORS is not enabled. The explicit unsafe development override below relaxes only origin validation, not the network listener or Host gate.
- `CC_CHAT_FRONTEND_ORIGIN` is a deliberate trust decision: JavaScript served by that origin can instruct Claude to execute commands locally, including Full access. Use only a frontend/deployment account you trust and control.
- No credentials or bearer tokens belong in the `host` query parameter. Native Claude credentials remain in Claude Code's local storage.
- CORS is a browser boundary, not authentication against software already running on the Mac. Do not expose this API through a public reverse proxy or tunnel.
- Legacy Private Network Access preflight headers are supported for approved origins, but modern Chromium uses a separate [Local Network Access permission](https://developer.chrome.com/blog/local-network-access).

## Allow every website origin — unsafe development only

If you deliberately need to test from arbitrary frontend origins:

```sh
CC_CHAT_ALLOW_ANY_ORIGIN=1 npm start
```

**Danger:** any website you visit may read conversations and instruct Claude to execute commands—even while the API binds only to loopback. This is especially risky with Full access. The backend prints a startup warning and the UI displays an unsafe-mode banner. Never use this setting with an unprotected remote endpoint. It does not bypass browser local-network permissions or mixed-content restrictions.

To secure it again, stop that backend and restart without `CC_CHAT_ALLOW_ANY_ORIGIN`, setting `CC_CHAT_FRONTEND_ORIGIN` to the single frontend you trust. Keep loopback binding, use default Claude permissions where practical, and add HTTPS plus authentication and a restricted network before considering remote access. CORS alone is not authentication.

## Identify the loaded build

The bottom-right bar shows **UI vYY.M.D-alpha.HMM** and its build time, independent of backend connectivity. Click it for the exact build ID, revision, and production/development mode. CalVer uses Asia/Bangkok; the detailed timestamp is UTC. The values are captured when Vite builds or starts, not taken from your browser’s clock.

`/version.json` reports the deployed artifact’s metadata without contacting the backend. Compare its build ID with the one in the page you already have open: a mismatch means the page is running an older build. The footer describes the **frontend**, not the installed Claude CLI or backend version. This does not fix or bypass a `Failed to fetch` error. No package version, Git tag, or release is created automatically.

## Browser compatibility

The client uses standard Fetch options and does not force the evolving `targetAddressSpace` enum; old PNA and new LNA browsers use incompatible values. Literal loopback URLs do not require that experimental option. Network errors include the browser’s reported reason rather than replacing it entirely with generic guidance.

If Drizzle Studio works but this origin does not, its permissions are not automatically shared with this frontend. Drizzle documents a trusted-local-TLS workaround for Safari/Brave using `mkcert`; this app has not installed a CA or silently changed your certificate trust. See [Drizzle’s documented browser limitations](https://orm.drizzle.team/docs/drizzle-kit-studio) and [Chromium’s Local Network Access guidance](https://developer.chrome.com/blog/local-network-access). Check the exact browser network error before changing CORS or TLS.

## Chrome works, Comet reports `ERR_BLOCKED_BY_CLIENT`

Chromium defines this error as the client choosing to block the request, not a response from this API. It does **not** identify a particular extension or prove that Local Network Access permission was denied. [Chromium network errors](https://chromium.googlesource.com/chromium/src/+/main/net/base/net_error_list.h)

For this site, try a narrow diagnostic change:

1. In Comet, open **Settings → Privacy → Blocking** and add `https://cc-chat-ui.laris.workers.dev` to **Adblock exceptions**. Keep global blocking enabled. Reload and retry. Remove the exception if it makes no difference. [Comet Adblock](https://www.perplexity.ai/help-center/comet/en/articles/11734702-adblock)
2. If still blocked, use **Settings → Extensions** to test privacy/content-blocking extensions one at a time; restore extensions that are not responsible. [Comet extensions](https://www.perplexity.ai/help-center/comet/en/articles/11734716-extensions)
3. Check this site’s permissions in Comet, separately from Chrome. If a local-network/device-access setting is shown, allow only this trusted site. Managed browsers may need an administrator to review local-network policies. [Comet site permissions](https://www.perplexity.ai/help-center/comet/en/articles/11629598-manage-site-permissions), [Comet enterprise policies](https://www.perplexity.ai/help-center/en/articles/13529668-comet-policies-and-controls)

The app opens **Connection help** when the initial workspace request fails, with the browser permission explanation, Comet instructions, a same-origin **Open local app** fallback for loopback backends, and **Retry connection**. Retry performs a read-only health check and restarts the REST/SSE connection; it never resends a prompt or starts a Claude run. A recovered connection clears the stale connection error and refreshes failed inventories. Dismissed help stays available in the disconnected banner instead of reopening on every SSE retry.

The popup is our help UI, not a browser permission dialog. JavaScript cannot grant that permission, bypass Comet’s filtering, or read the DevTools-only error code from a generic `Failed to fetch`. No browser security settings or backend origin guards are changed automatically. Chrome connectivity has been confirmed by the user; the specific Comet blocker still needs the above per-site test.

## Verification

```sh
npm run check
curl -i -H 'Origin: https://cc-chat-ui.laris.workers.dev' http://127.0.0.1:4318/api/health
curl -N -H 'Origin: https://cc-chat-ui.laris.workers.dev' http://127.0.0.1:4318/api/events
```

For a non-billable isolated end-to-end test:

```sh
CC_CHAT_FRONTEND_ORIGIN=https://cc-chat-ui.laris.workers.dev node scripts/smoke-server.mjs
```

Open the hosted frontend with `?host=http://127.0.0.1:4319`. That port uses temporary fixture data and a fake Claude runner. Port 4318 remains the real local backend.
