# ARRA Claude Code Server for macOS

The desktop build is a Tauri 2 menu-bar controller for the existing local application. It does not reimplement or proxy the API: it launches `server/index.mjs`, which serves the production UI, REST endpoints, SSE stream, Claude Agent SDK integration, session history, and local state exactly as `npm start` does.

## Build

Requirements: macOS, Node.js 22.12 or newer, npm, Just, and the stable Rust toolchain.

```bash
npm install
npm run check
npm run tauri:test
just desktop-build
just desktop-open
```

`desktop-build` safely unmounts a stale mounted copy of this product, runs the Tauri build and DMG finalizer, then verifies the finished image. `desktop-open` verifies that same finalized DMG again before opening it; it never opens Tauri's intermediate image. For a read-only check without rebuilding or opening Finder, run `just desktop-verify`.

The app bundle is produced under `src-tauri/target/release/bundle/macos/`; the finalized DMG is produced under `src-tauri/target/release/bundle/dmg/`. Verification checks the configured app/Applications icon alignment, confirms the mounted installer contains the app and Applications shortcut, and rejects a visible `.VolumeIcon.icns`.

## Menu

- **Target** shows the loopback dashboard address.
- **Local server** distinguishes a backend launched by the app from an external process already using the port.
- **Restart local server** restarts only a child owned by the app. It never terminates another process.
- **Open dashboard** opens the same local UI at `http://127.0.0.1:4318`.
- **Show recent output** reveals the backend log in Finder.
- **Quit** stops the owned backend before exiting.

The default port is `4318`. For isolated testing, launch the executable with `CC_CHAT_PORT=4327` and a separate `CC_CHAT_DATA_DIR`. Set `CC_CHAT_NODE_BINARY` to an absolute Node executable when Node is not installed in `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, or the app's `PATH`. Set `CC_CHAT_CWD` to override the initial workspace; otherwise the desktop app uses your home directory.

## Compatibility and data

The native host bundles `server/`, `dist/`, `package.json`, and runtime `node_modules/`. Because both launch paths execute the same backend modules, the existing Node API suite is also the desktop compatibility suite. Desktop state is stored in the app's macOS Application Support directory and logs in the standard app log directory; neither is written into the signed app bundle.

The HTTP server remains bound to loopback, validates its `Host` header, and preserves the existing origin policy. The app does not add remote access, authentication, or a tunnel. Full access still invokes Claude with bypassed permission prompts; use it only with trusted repositories.

## Hosted workspace and ports

**Open hosted workspace** constructs the Cloudflare URL using the active port, for example:

- [Real backend on 4318](https://cc-chat-ui.laris.workers.dev/?host=http://127.0.0.1:4318)
- [Alternate backend on 4327](https://cc-chat-ui.laris.workers.dev/?host=http://127.0.0.1:4327) — only works when a backend is running there.

The tray's owned backend allows the exact `https://cc-chat-ui.laris.workers.dev` origin by default. It does not need allow-all CORS. An existing external server retains its own origin settings; the tray checks and reports whether hosted access is allowed. Browser local-network permission and site-specific blockers still apply; see [connection help](cloudflare.md#browser-compatibility).

The sidebar always displays **Backend** and the selected address near **Local on this Mac**, including alternate ports. Port `4319` is used by `scripts/smoke-server.mjs` for tutorial fixtures (such as `discovered-repo` and the 235-message archive); those are not personal conversations. Port numbers alone do not determine whether data is real—check which server was started there.

## Extra tray controls

- Counts show saved projects, chats and messages, active chats, and sync errors. These are not the total native Claude session inventory.
- Claude CLI availability/version and hosted-origin access are checked against the connected API.
- **Start**, **Stop**, and **Restart** affect only the process this tray launched. Stop/restart interrupt active chats. An occupied port is never treated as process ownership.
- **Refresh status** is read-only. It does not send a prompt or force history reconciliation. Automatic refresh runs every five seconds.
- **Open saved chats**, **Open recent output**, and **Settings → Open launch data folder** provide shortcuts. Logs include timestamps and PIDs, so old launches on a test port can be distinguished.
- An older backend without the summary endpoint reports counts as unavailable rather than inventing numbers.

## Persistent settings

Use **Settings → Edit server settings** to edit `server-config.json` in the app's Application Support directory. Fields are `port`, `workspace`, `data_dir`, `frontend_origin`, and `node_binary`. Use absolute paths; `workspace` must exist. `frontend_origin` accepts one exact HTTPS origin, or `""` for local-only access. Set `node_binary` to `null` for PATH discovery.

Stop the owned backend, choose **Reload settings**, then **Start local server**. Invalid settings leave the current effective configuration unchanged and show an error in the menu. If settings are invalid at startup, the tray stays available for Edit/Reload/Quit without launching a backend. This does not restart or reconfigure an external server. The app keeps the previous desktop data location by default; changing `data_dir` selects a different store and does not migrate conversations.

Environment variables `CC_CHAT_PORT`, `CC_CHAT_CWD`, `CC_CHAT_DATA_DIR`, `CC_CHAT_FRONTEND_ORIGIN`, and `CC_CHAT_NODE_BINARY` override persisted values for that launch, without saving the overrides. Finder launches normally use the persisted settings. A configured Node path never silently falls back to another executable. The child PATH includes common Homebrew and `~/.local/bin` locations for Claude Code.

## Installer layout

The DMG places the app and Applications shortcut on the same horizontal line. The build finalizer removes the optional disk-volume icon file so `.VolumeIcon.icns` does not appear as a third item when Finder shows hidden files. The app's icon is unchanged; no Finder preferences are modified. The original DMG is replaced only after the rebuilt image passes `hdiutil verify`.
