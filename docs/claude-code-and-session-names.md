# Claude Code and AI-assisted session names

[← README](../README.md) · [Features](features.md) · [Complete visual tour](tutorials/claude-only-complete-tour.md)

ARRA uses **Claude Code only** on **http://127.0.0.1:4318**. Choose Claude Sonnet, Opus, or Haiku in the composer. The app uses your normal Claude Code login or official Anthropic credentials. No second provider key is required.

## Update the installed app

```sh
just desktop-update-claude
```

This runs the project checks, builds a fresh visible CalVer version, backs up the installed runtime and saved state, and updates/restarts this account's idle installed app on port 4318. It verifies the installed build ID, Claude-only health, and existing histories. Claude and tmux sessions are not stopped. Busy or unrecognized apps are left untouched.

To restart the already-updated runtime without rebuilding:

```sh
just desktop-claude
```

These recipes preserve normal Claude login settings and official credentials, while removing obsolete endpoint, model, and third-party credential overrides from the child environment. They do not edit global Claude settings or store API keys. This is a local installed update, not a GitHub or Cloudflare release.

If verification fails, rollback restores only the app runtime, never overwrites current conversation data, and retains the owner-only backup for inspection.

## Previous non-Claude conversations

GLM support and its launcher recipes have been removed. Existing non-Claude conversations and isolated workspace data are not deleted or migrated. Saved non-Claude chats stay readable/exportable but cannot send, switch models, be deleted, run Claude commands, or change native history. Their native-session duplicates are also read-only. Start a new Claude chat to continue.

## Suggest session names with AI

Suggestions are always explicit. ARRA never names, renames, or migrates a session automatically.

Open either entry point:

1. Open a repository’s **⋯** menu and choose **Suggest session names**. Select one thread in the dialog.
2. Open a thread’s rename dialog and choose **Suggest session names with AI**.

Choose **Haiku** or **Sonnet** for summarization, then select **Generate suggestions**. ARRA makes two charged Claude calls: the selected summary model creates a bounded summary, then Opus proposes exactly three names. Only one session is processed per request. You choose a suggestion—or edit your own title—and explicitly save it.

Haiku/Sonnet summarize the conversation; Opus suggests names. Normal Claude usage and charges apply.

### Naming safety boundaries

- The prompt contains a bounded text-only head-and-tail excerpt, at most about 24,000 characters. Native history reads at most 200 messages and reports when the source or excerpt was truncated.
- Tool inputs/results, repository paths, project identifiers, message identifiers, and session identifiers are not added to the naming prompt.
- Each stage is a stateless, no-tools `claude -p` call in an isolated temporary folder. It does not resume the conversation, create a persistent session, load project settings/hooks/MCP configuration, or read the conversation’s repository.
- Cancelling the dialog aborts the active naming process. Only one naming job runs at a time on a backend.
- Saving changes only ARRA’s stored display alias. It does not rename the original native Claude session or alter its ID, transcript, history, or repository.
- The save includes the title that was current when the dialog opened. If another rename wins first, ARRA returns a conflict instead of overwriting the newer title.

Automated verification uses fake CLI adapters to check request bounds, process flags, cancellation, credential separation, and store-only aliases. A separate live smoke check on 13 September 2026 ran Haiku → Opus against a two-message synthetic KVM networking conversation and returned three valid names. No existing conversation was resumed or renamed by that smoke check.

## Operational notes

- Keep the service on its configured loopback or authenticated remote boundary. A private VPN does not make unauthenticated public exposure safe.
- Existing native Claude names and history remain authoritative outside ARRA. Suggested aliases are presentation metadata in the selected ARRA backend.
- Standard Claude chats retain their existing resume, tmux, and one-shot commands.
