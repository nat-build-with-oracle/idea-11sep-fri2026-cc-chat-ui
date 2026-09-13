# ARRA Claude Code

A Codex-inspired chat UI for Claude Code on your Mac. Real sessions, repository threads, and streaming replies.

![ARRA Claude Code new-chat workspace](docs/images/claude-only-tour/01-new-chat.jpg)

**[Explore features →](docs/features.md)** · [Claude Code and AI naming](docs/claude-code-and-session-names.md) · [Complete visual tour · 20 images](docs/tutorials/claude-only-complete-tour.md) · [Releases](https://github.com/nat-build-with-oracle/idea-11sep-fri2026-cc-chat-ui/releases) · [Deployment](docs/cloudflare.md)

**Current source alpha: `v26.9.13-alpha.1324`.** Claude Code only; previous non-Claude chats remain read-only. This release does not ship a prebuilt DMG or update the hosted Cloudflare UI. [Release notes](docs/releases/v26.9.13-alpha.1324.md).

## See it in action

| Stream a reply | Pick up a saved session |
| --- | --- |
| ![Fixture reply with token usage](docs/images/claude-only-tour/03-chat-reply.jpg) | ![Saved Claude sessions](docs/images/claude-only-tour/14-saved-sessions.jpg) |

| Organize each project | Load the whole conversation |
| --- | --- |
| ![Repository sorting, rename, and hide controls](docs/images/claude-only-tour/11-project-tools.jpg) | ![Long conversation fully loaded](docs/images/claude-only-tour/16-history-loaded.jpg) |

| Share Oracle context with `@` | Alias + Session ID + CLI |
| --- | --- |
| ![Oracle and session mention picker](docs/images/claude-only-tour/06-context-mentions.jpg) | ![Native session identity and details](docs/images/claude-only-tour/18-session-details.jpg) |

| Expand every terminal command | Autocomplete `/` commands |
| --- | --- |
| ![Full resume, tmux, and one-shot commands](docs/images/claude-only-tour/05-session-commands.jpg) | ![Slash command suggestions](docs/images/claude-only-tour/08-slash-commands.jpg) |

These captures use synthetic data and fake model responses. The fake runner writes no Claude JSONL, so its history-sync badge remains unresolved; it is not live-sync evidence. See the tour for capture and verification limits.

**[Open the complete Claude-only visual walkthrough →](docs/tutorials/claude-only-complete-tour.md)**

## Quick start

Requires Node.js supported by Vite 8 and Claude Code installed on your Mac. From this cloned repository:

```sh
claude auth login
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Keep the backend running.

### macOS menu-bar server

The Tauri app packages the same frontend and supervises the same Node backend on `127.0.0.1:4318`. Its native menu shows server ownership and status, opens the dashboard, restarts a backend it launched, reveals recent output, and quits cleanly.

```bash
just desktop-build
just desktop-open
```

[Desktop build, runtime, and security notes →](docs/desktop.md)

> **Full access is on by default.** Claude can modify files and run commands without asking. Use trusted projects, or select **Default permissions**. Never expose the unauthenticated backend publicly.

## Use the hosted UI

```sh
CC_CHAT_FRONTEND_ORIGIN=https://cc-chat-ui.laris.workers.dev npm start
```

**[Open workspace →](https://cc-chat-ui.laris.workers.dev/?host=http://127.0.0.1:4318)** · Keep the backend running on this Mac. Allow this trusted site’s local-device access when prompted.

Cloudflare hosts the interface; conversations and execution stay on your selected backend. Claude Code contacts Anthropic. [Setup and security →](docs/cloudflare.md)

## Comet blocking the connection?

![Comet shield menu with Block ads and trackers off for this site](docs/images/comet-site-adblock-off.png)

**Shield → “Block ads and trackers” off for this site only → Reload.** If it does not help, restore blocking. [Troubleshooting →](docs/cloudflare.md#quick-per-site-fix-the-shield-menu)

## Special thanks

Special thanks to **Pinyo Boy Tanradtanamonthon** for the idea that inspired ARRA Claude Code.

---

[MIT license](LICENSE) · Built with React, TypeScript, Vite, and Tailwind CSS. Independent project—not an official Anthropic or OpenAI app.
