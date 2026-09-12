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

Select **Connect to this Mac** on the hosted page. Chromium may ask for permission to access your local network; allow it for this site. This permission belongs to your browser, not the app. A denied permission, stopped backend, or mismatched allowed origin prevents connection. Safari compatibility is not yet browser-verified; the local frontend remains available as a fallback.

The backend binds only to `127.0.0.1:4318`. `?host=` selects the browser's own local backend—not the Cloudflare server's network. Bare `127.0.0.1:4318` and an explicit HTTP(S) loopback origin are accepted. Other ports can target isolated local instances. Remote/LAN hostnames, credentials, paths, and tokens are rejected. The address remains in the URL through navigation, refresh, and preview links. Hosted drafts, selections, and hidden repositories are scoped to the selected backend origin.

Opening this link on a phone points to the phone's loopback, not your Mac. This setup is intentionally **not** remote access or a public backend tunnel.

## Deploy your own frontend

```sh
npm run deploy
```

The script builds with Vite and runs the pinned Wrangler CLI through `npx`; authenticate using `npx wrangler@4.130.0 login` if needed. Set `CLOUDFLARE_ACCOUNT_ID` when your login can access multiple accounts. Change `name` in `wrangler.jsonc` for your own Worker, then allow its exact HTTPS origin in `CC_CHAT_FRONTEND_ORIGIN` when starting the backend.

Only `dist/` is uploaded. There is no Worker API proxy, SSR, database, Claude SDK, transcript, or local state in the deployment. The configuration uses Workers Static Assets with no custom `main` or `run_worker_first`. [Cloudflare documents static-asset requests as free and unlimited](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/); it does not make Claude model usage free.

## Trust boundary

- Your browser downloads the UI from Cloudflare and talks directly to the local API for REST and SSE streaming.
- The backend still validates a loopback Host, and only the exact opted-in HTTPS frontend origin gets CORS access. Unknown origins cannot read or mutate the API. Credentials and wildcard CORS are not enabled.
- `CC_CHAT_FRONTEND_ORIGIN` is a deliberate trust decision: JavaScript served by that origin can instruct Claude to execute commands locally, including Full access. Use only a frontend/deployment account you trust and control.
- No credentials or bearer tokens belong in the `host` query parameter. Native Claude credentials remain in Claude Code's local storage.
- CORS is a browser boundary, not authentication against software already running on the Mac. Do not expose this API through a public reverse proxy or tunnel.
- Legacy Private Network Access preflight headers are supported for approved origins, but modern Chromium uses a separate [Local Network Access permission](https://developer.chrome.com/blog/local-network-access).

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
