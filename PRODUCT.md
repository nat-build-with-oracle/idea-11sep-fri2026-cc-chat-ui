# Claude Code Workspace

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the user: React, TypeScript, Vite, and Tailwind CSS. A Node.js server uses the installed Claude Code CLI, not a hosted model API.

## Users

A developer using Claude Code on their own Mac. The user confirmed single-user, local deployment using their existing CLI login.

## Product Purpose

A Codex-style interface for starting and resuming Claude Code conversations, remembering chat names and messages, and organizing work by local project directory.

## Operating Context

Claude Code is installed locally. New conversations have distinct sessions; follow-up messages resume the same session. Projects define the CLI working directory. State persists locally across browser and server restarts.

## Capabilities and Constraints

- Create, rename, find, resume, and remove saved conversations; assign a project.
- Stream Claude output and tool activity; stop an active run.
- Support headless `-p`, explicit session IDs, `--resume`, and the requested `--dangerously-skip-permissions` mode.
- Full access bypasses Claude permission prompts and must be visibly distinguished from default permissions.
- Bind the backend to loopback only. A public Cloudflare Static Assets frontend may connect directly from the same Mac through a validated `?host=` loopback origin, with explicit hosted-origin trust and browser local-network permission. Public backend exposure, remote access, and multi-user authentication remain out of scope.
- No synthetic conversation history presented as real user data.

## Brand Commitments

The two supplied Codex screenshots are the visual reference: dark app shell, sidebar history and projects, restrained controls, bottom composer. Identify the actual engine as Claude Code; do not imply an official Anthropic or OpenAI product.

## Evidence on Hand

`/Users/beta/Desktop/Screenshot 2569-09-11 at 19.42.30.png` and `Screenshot 2569-09-11 at 19.42.27.png`. Installed Claude Code 2.1.268.

## Product Principles

- Existing sessions stay continuous; new chats are genuinely new sessions.
- Local state is durable and never fabricated.
- A project's working directory is explicit.
- Errors and permission scope are visible and actionable.

## Updated Appearance Direction — 11 September 2026

The user found the initial dark UI hard to see and asked for a youthful, modern, themeable interface. This supersedes mockup B's color/typographic treatment while retaining its conversation layout. Default to a readable bright Pop theme; offer Light and Dark plus larger reading text. Save appearance preferences locally. Real Claude sessions remain the live data source; the separate design fixture is not production data.
