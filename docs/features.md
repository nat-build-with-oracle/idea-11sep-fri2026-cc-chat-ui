# Features and boundaries

[← README](../README.md) · [Tutorial](tutorials/using-claude-code-chat-ui.md) · [Deployment and troubleshooting](cloudflare.md)

## Chats and projects

- **New chat:** the first message creates a distinct Claude session. Later messages use `claude -p --resume` with that session's UUID.
- **Projects = repositories, sessions = threads:** discover repositories under `ghq root`, ordered by recent filesystem activity, with matching Claude threads nested underneath. Search repositories, open real history without importing, or start a new thread. You can still add an existing absolute folder manually; a started session’s project is locked.
- **Favorite repositories:** click the star beside a repository to pin it above recent repositories. Favorites stay visible beyond the recent-list limit. Stars and display labels are saved per backend in this browser.
- **Repository display names:** open **⋯ → Rename display name** beside a repository. This changes only the browser label, never its folder path or native sessions. Leave the label blank to reset it.
- **Per-folder thread sorting:** open a repository’s **⋯** menu and choose **Latest updated** or **Name A–Z**. The choice is saved separately for each repository. App chats and native Claude sessions share one ordering; latest uses app conversation updates and the SDK session’s last-modified time, falling back to session start when unavailable.
- **Hide repositories:** open **⋯ → Hide from sidebar** beside a repository. The preference survives refresh in this browser. Expand **Hidden repositories** to restore it. This hides only the sidebar repository row—not files, sessions, search results, or the project selector.
- **Conversations:** streamed text, compact expandable Activity groups, Stop, model selection, searchable names/messages, Markdown export, and locally saved drafts. Expanded tool rows pair **Command** and **Output** panels, preserve shell text while colorizing tokens, pretty-print JSON, keep plain logs plain, and offer Copy plus a Raw JSON toggle when the original payload differs.
- **URLs and browser history:** chats, native sessions, source tabs, search filters, and new-chat projects have stable `#/…` URLs. Refresh restores the URL; browser Back/Forward restores navigation without sending a prompt.
- **Token usage:** completed replies show reported input/output counts, cache read/write breakdown, and estimated USD cost when Claude supplies it. All-model totals include subagents; older main-agent-only counts and historical per-response counts are labeled separately. Missing usage is labeled unavailable; counts are not context-window estimates.
- **Appearance:** Pop, Light, and Dark themes, plus Comfortable/Larger reading sizes. The Theme control saves browser preferences immediately.
- **Your chats:** a personal inbox with real status filters and project-derived initials—not invented agent portraits or presence. Sidebar destinations stay neutral until current; `aria-current` and one shared selected tint prevent New chat and Your chats from looking active together.
- **Rename threads:** use the pencil beside a sidebar thread (shown on hover, keyboard focus, or touch), Session details, or `/rename My session name`. The pencil targets that thread without navigating away from the conversation you are reading. Active native sessions must be stopped before renaming. Existing native names are updated through the official Claude Agent SDK, not by rewriting transcript files.
- **Native sessions:** browse three non-overlapping sources: **Agents** shows background jobs from `claude agents --json --all`, **Terminals** shows interactive CLI sessions, and **Saved** shows conversations from the SDK. An attached background job stays in Agents instead of appearing twice. Inspect history, load longer conversations, and resume inactive sessions here. Active session history remains read-only; copy its terminal command to continue in Claude Code. **Set display alias** stays available while the terminal is open: it changes only the ARRA label, preserving the original Claude name, ID, and history. Aliases persist on the selected backend and carry over when importing later.
- **Load all remaining:** one click loads history pages in sequence, with a page count and **Stop loading**. **Load more** still fetches one page. **Follow latest** is on by default: new messages, streamed output, expanded tools, and loaded history stay at the bottom. Pause it to read earlier messages; the floating **Jump to bottom** resumes following. Your choice is remembered per backend. Stopping, navigating away, or a failed request keeps completed pages; retry continues at the saved cursor. Imported chat pages persist on the backend; unimported native-view pages remain in this tab until navigation or refresh. Each action stops after 100 pages to bound work, explicitly says when more remains, and can be continued with another click.
- **Remove from workspace:** removes only this app's chat record, never the native transcript or project files.

The SDK supplies saved session listing, history, and rename. The installed CLI supplies execution and live-agent inventory. Their supported behavior can vary with installed versions.

Within each source, the app sorts by newest reported `startedAt`. Background jobs are grouped as Needs input, Working, Completed, or Unknown state; failed and stopped jobs remain under Completed while retaining their exact status label. This is an explicit approximation of Claude Code's native Agents view because its internal tie-break and ordering key are not exposed.

### Full access

**Full access is enabled by default.** It adds `--dangerously-skip-permissions`: Claude may change files, run commands, and access services without asking. Use only trusted projects. This app is not a sandbox.

Choose **Default permissions** in the composer to omit that flag. This headless UI cannot display Claude's interactive permission dialogs; requests requiring approval may be denied. Use the terminal for those workflows.

### Agent messaging

Type **/** at the start of the composer to autocomplete **/rename** or **/list-agents**, just like the **@** picker. Use **↑ / ↓**, then **Enter** or **Tab** to insert the command without sending it. Add arguments before sending; **Esc** closes suggestions. `/rename` is handled by this app; `/list-agents` is sent to Claude and depends on its runtime support.

`/list-agents` inside Claude discovers eligible messageable peers. Native `ListAgents` and `SendMessage` are Claude runtime tools, **not** public host-side SDK RPC methods. The session inventory is not a list of verified messaging targets. Availability depends on Claude Code's runtime capabilities and recipient policy. This UI does not write private mailboxes or sockets or send peer messages automatically. See [Anthropic's cross-session messaging documentation](https://code.claude.com/docs/en/cross-session-messaging).

### Terminal / TTY

The current Chat stream is structured JSON, **not a TTY**. A real terminal tab is feasible but not implemented; it would need a server-owned PTY, a browser terminal emulator, bidirectional input, and resize/lifecycle handling. `claude attach` applies to supported background jobs, not arbitrary running session UUIDs.

## CLI ↔ web history sync

**Web send:** Claude's `stream-json` stdout → backend message store → SSE → browser. **External terminal send:** saved Claude history → SDK metadata/history polling → reconciliation → SSE. ARRA does not directly watch or reload raw JSONL files. An unimported, read-only native view loads history on demand; reopen or refresh it to fetch updates. Automatic reconciliation below applies to saved app chats linked to a Claude session.

Chats linked to a Claude session now catch up automatically through the local backend, including chats first created here. The backend checks saved-session metadata every 2 seconds, reads changed history with the official SDK, and publishes the reconciled conversation through the existing SSE connection. A forced audit every 60 seconds also catches edits whose size/mtime stayed unchanged. Failed reads back off up to 30 seconds; at most three chats are checked concurrently, with a five-second wait bound per read. **Sync now** forces an immediate check.

**Synced with Claude** means the last complete SDK snapshot was reconciled. Its tooltip includes a SHA-256 fingerprint of normalized native message IDs/content/blocks/tools/usage—not raw JSONL bytes or rendered HTML. Message UUIDs prevent duplicates; repeated identical prompts remain separate messages. Legacy web turns are matched in order once, preserving their IDs and whole-turn token/cost totals; ambiguous matches stop with a warning rather than guessing. New streamed responses capture native record UUIDs directly. Without a saved whole-turn total, native API usage entries remain separate. Record counts can differ from visible bubbles because one web response can represent several tool/text records.

The sync reader never writes Claude transcripts or sends a model prompt. It does not overwrite a running web response. Failed attempts that never reached Claude remain visibly labeled as local-only and do not block subsequent sync. Missing/unmatched history is retained locally with **Sync needs attention**, rather than silently deleting messages. Snapshots are capped at 10,000 returned native records (the SDK may parse more transcript data internally); larger sessions retain their cache and show an error. Startup and reconnect trigger catch-up without requiring a new message.

**One writer at a time:** viewing/syncing a session while a CLI terminal is open is supported. Sending from the web is blocked while another Claude process holds the session, even if its last turn is finished and the terminal is idle. The error identifies the PID when available; exit that interactive session before resuming here. A completed `claude -p` process is not itself an active writer, but another open terminal may still hold the same session. External ownership checks cannot prevent a separate terminal from starting immediately after a check.

## Local data and boundaries

App metadata and conversation copies are stored in `.local/state.json` (gitignored, owner-only file permissions). Set `CC_CHAT_DATA_DIR` to choose another location. Native transcripts remain under Claude Code's own storage. Keep backups if you need durable archives.

By default, the server binds only to `127.0.0.1`, checks Host/Origin, and rejects untrusted cross-origin requests. The explicit unsafe `CC_CHAT_ALLOW_ANY_ORIGIN=1` override relaxes origin checks; see [deployment security](cloudflare.md#allow-every-website-origin--unsafe-development-only). A hosted frontend requires an explicit exact `CC_CHAT_FRONTEND_ORIGIN` opt-in. Do not expose it through a public tunnel, reverse proxy, or shared machine account: it has no multi-user authentication. Local storage does **not** mean offline model execution—Claude Code still communicates with Anthropic using your account.

`/?preview=oracle` is an explicitly labeled, non-executable design preview with illustrative conversations. It does not populate live app data or overwrite your live selected conversation or drafts. Old preview conversation links recover to a new live chat. Oracle registry dates shown there are historical, not live presence.

## Verify

```sh
npm run check  # tests, ESLint, TypeScript, production build
```

For an isolated browser test, run `node scripts/smoke-server.mjs` after building and open `http://127.0.0.1:4319`. It uses temporary fake data; it never invokes Claude.

Tests use fake CLI/SDK adapters; they do not send model requests or mutate personal Claude sessions. The official SDK is the only added runtime integration dependency beyond React.

## Build version

The bottom-right bar always shows the UI’s CalVer version and build time, even when the backend is unreachable or the sidebar is hidden. Click it for the full build ID, source revision, and build mode. Every build uses the Asia/Bangkok `vYY.M.D-alpha.HMM` convention; the timestamp includes milliseconds to distinguish builds from the same minute. This is frontend build metadata, not a package release or proof of a backend connection. Production builds also emit [`version.json`](https://cc-chat-ui.laris.workers.dev/version.json).

## Known boundaries

- Native discovery is bounded to the newest 500 SDK sessions plus CLI inventory.
- Automatic sync completes imported history when it fits the snapshot bound. Otherwise load all imported history before sending; pages and their cursor are saved in the app store. Sync errors must be resolved before resuming from the web.
- Native ownership checks are snapshots. The app fails closed when ownership cannot be checked, but cannot lock an unrelated external Claude process.
- SDK rename and local app persistence cannot be one cross-store transaction if the local disk fails after a successful native rename.
- Automated execution, rename, cancellation, and error checks use isolated CLI/SDK fixtures; passing tests does not prove compatibility with every installed CLI version or browser.
- Repository discovery uses the configured `ghq root`, caches results for 60 seconds, and returns at most the 1,000 most recently modified repositories found within its traversal budget. It prunes repository contents and common generated/cache folders, supports `.git` files for worktrees, and deduplicates symlink aliases. Recency means directory/top-level-entry mtime, not recursive file activity or git commit time. A visible warning reports truncated scans; manually adding a folder remains available without ghq.
- Discovery and viewing native threads do not import conversations or register projects. A discovered repository is registered on the first message, keeping its new thread assigned to that repository.

## Production build

From the repository, run:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4318** and keep the backend running. Use the [Tauri menu-bar server](desktop.md) for a packaged macOS controller of the same backend.

## References

- [Claude CLI](https://code.claude.com/docs/en/cli-usage), [headless execution](https://code.claude.com/docs/en/headless), [Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Original proposal](../PROPOSAL.md)

## Mention repositories and sessions

Type **@** in the composer, then select an Oracle, repository, or session. Folders ending in **`-oracle`** are labeled **Oracle**, based on their actual path rather than their display alias. Search by its name, folder path, or Claude session ID. Use **↑ / ↓** and **Enter** to select, or **Esc** to dismiss.

Selected references show removable context chips. A repository includes its full path; a session includes its displayed name, native Claude session ID, and project path. Only names, IDs and paths are attached—not conversation history. Referencing a session does not resume it, send it a message, or change the current chat's project. The expanded context is saved with the exact message sent to Claude so native-history sync remains consistent.

The conversation header shows its **Claude Session ID**. Click it to copy the full value for `claude --resume`; this is separate from the browser's saved-chat route ID. The full **CLI** command underneath copies the resume command with the known project folder; copying never runs it. Sending with Enter returns focus to the composer after the request completes, ready for the next draft.

**Show all commands** expands the complete, selectable resume, tmux, and one-shot commands, each with its own Copy button. Collapse it with **Hide commands**. Beside the CLI line, **Copy tmux** creates a command for a named tmux session (`repo-chat-title`) and `maw a` attachment. It requires both tools; an existing name stops the command instead of attaching to a different session. **Copy -p test** copies a one-shot prompt using the same Claude session ID and folder, with tools disabled. Running it uses Claude quota and adds a test turn to that session. Finish any existing Claude writer first. These buttons only copy text; they never launch a terminal or run a prompt.
