# Project working preferences

## Shared instructions and Serena MCP

- Use Serena MCP for code navigation: read its initial instructions, activate the target repository, check onboarding, then use scoped symbol or pattern queries before editing.
- Keep project instructions in `AGENTS.md`; `CLAUDE.md` must be a relative symlink to `AGENTS.md` so both agents read the same rules. Preserve any unique contents before replacing a regular instruction file.

## Implement first, tests later

- For clear, low-risk UI changes, make the smallest working change first. Test-first development is not a prerequisite.
- When the user requests rapid iteration without tests, defer adding, rewriting, and running automated tests to a later validation pass, wherever governing instructions permit. Avoid running the full suite after every small tweak.
- Preserve existing tests. Report what changed, which checks actually ran, and any deferred validation; never label untested behavior as verified.
- Required safety, security, data-integrity, and higher-priority verification checks still apply.

## ARRA Office fixes: maw-rs only

- For connection, authentication, and empty-session problems at `https://god.buildwithoracle.com/`, fix `maw-rs` or its local backend runtime only.
- Treat the hosted Office UI and the `Soul-Brews-Studio/maw-ui` source as read-only. Do not edit, rebuild, or deploy that frontend, or change its browser settings, unless the user explicitly authorizes it.
- Use isolated `$incubate` worktrees and Serena indexing to learn the frontend/backend contract without changing Office code. Preserve unrelated existing edits.
- Preserve running Claude and tmux sessions. Managing a daemon owned by another OS user requires that account's authority or administrator authentication; do not weaken permissions or bypass authentication to reach it.

## Visible release versions

- For installed app updates, use `$calver` conventions and this project's `scripts/build-info.ts` to build a fresh visible version. Verify the installed `/version.json` and UI footer, and report that version after installation.
- Distinguish a local installed update from a published GitHub or Cloudflare release; report only what was actually shipped.

## Remote access compatibility

- Preserve support for authenticated remote backends beyond NetBird; the frontend's remote backend URL support is not VPN-only.
- Keep the trusted-VPN `NO_AUTH` shortcut scoped to the VPN. Require authentication for broader remote exposure.

## Project origin

# idea-11sep-fri2026-cc-chat-ui — an idea, kept

> cc-chat-ui

Born 19:42 +07 from the day nat-build-with-oracle/11sep-fri2026-oracle, by 'maw today idea'
(nat-build-with-oracle/maw-today).

An idea capsule, not yet a project: PROPOSAL.md says what it is, why now, what it
would take, and when it is done; the /awaken-shaped vault holds whatever the idea
grows — notes in ψ/inbox, drafts in ψ/writing, experiments in ψ/lab. If it
becomes real, /incubate or /awaken it from here; if it never does, it stays as the
record that the thought happened, and the day it came from knows it left one.

AI-generated per fleet Rule 6: assembled by an oracle, commissioned by Nat Weerawan.
