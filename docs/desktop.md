# ARRA Claude Code Server for macOS

The desktop build is a Tauri 2 menu-bar controller for the existing local application. It does not reimplement or proxy the API: it launches `server/index.mjs`, which serves the production UI, REST endpoints, SSE stream, Claude Agent SDK integration, session history, and local state exactly as `npm start` does.

## Build

Requirements: macOS, Node.js 18 or newer, npm, and the stable Rust toolchain.

```bash
npm install
npm run check
npm run tauri:test
npm run tauri:build
open "src-tauri/target/release/bundle/macos/ARRA Claude Code Server.app"
```

The app bundle is produced under `src-tauri/target/release/bundle/macos/`; a DMG is produced under `src-tauri/target/release/bundle/dmg/`.

## Menu

- **Target** shows the loopback dashboard address.
- **Local server** distinguishes a backend launched by the app from an external process already using the port.
- **Restart local server** restarts only a child owned by the app. It never terminates another process.
- **Open dashboard** opens the same local UI at `http://127.0.0.1:4318`.
- **Show recent output** reveals the backend log in Finder.
- **Quit** stops the owned backend before exiting.

The default port is `4318`. For isolated testing, launch the executable with `CC_CHAT_PORT=4319`. Set `CC_CHAT_NODE_BINARY` to an absolute Node executable when Node is not installed in `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, or the app's `PATH`. Set `CC_CHAT_CWD` to override the initial workspace; otherwise the desktop app uses your home directory.

## Compatibility and data

The native host bundles `server/`, `dist/`, `package.json`, and runtime `node_modules/`. Because both launch paths execute the same backend modules, the existing Node API suite is also the desktop compatibility suite. Desktop state is stored in the app's macOS Application Support directory and logs in the standard app log directory; neither is written into the signed app bundle.

The HTTP server remains bound to loopback, validates its `Host` header, and preserves the existing origin policy. The app does not add remote access, authentication, or a tunnel. Full access still invokes Claude with bypassed permission prompts; use it only with trusted repositories.
