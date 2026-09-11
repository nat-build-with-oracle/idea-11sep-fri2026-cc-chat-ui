# Use the local Claude Code chat UI

For developers running this app on a Mac with Claude Code installed; completion is a refreshed new-chat screen with a stable URL.

## Before you begin

- Install Claude Code and authenticate locally with `claude auth login`.
- Start this app with `npm install && npm run dev`.
- Keep projects trusted when using **Full access**; it enables `--dangerously-skip-permissions`.

## Steps

1. **Start a new chat** — Open [http://127.0.0.1:5173/#/new](http://127.0.0.1:5173/#/new) and select **New chat**.
   - **Expected result:** The page shows **What’s the move?** and a **Message Claude** composer.
2. **Choose a project (optional)** — Use **Conversation project** and select a configured project.
   - **Expected result:** The URL becomes `#/new?project=<id>`; the selection survives refresh.
3. **Send a message** — Enter a prompt and select the arrow **Send message** button.
   - **Expected result:** The app replaces the draft URL with `#/chats/<id>`, streams the reply, and saves the conversation locally.
4. **Inspect usage** — Expand the token summary under a completed Claude reply.
   - **Expected result:** You can see input, output, cache read/write counts, and estimated cost when Claude reports them.
5. **Browse native sessions** — Select **Your chats**, then **Agents**, **Terminals**, or **Saved**.
   - **Expected result:** The list is loaded from Claude’s local session data and the selected tab is reflected in the URL.
6. **Open and resume a session** — Select a saved native session.
   - **Expected result:** Its history opens at a stable `#/sessions/<session-id>` URL; **Resume here** imports it without changing the native session identity.
7. **Use browser navigation** — Use the browser Back and Forward buttons.
   - **Expected result:** The previous tab, search, or conversation restores without sending a prompt.

## Verify

Refresh the current page. The same route, project, conversation, or native session remains selected.

## Troubleshooting

- **Claude Code wasn’t found** — Run `claude auth login`, verify `claude` is on your PATH, then restart the app.
- **A native session is active** — Continue it in its terminal; only stopped sessions can be resumed here.
- **Token usage was not reported** — This is an honest unavailable state; the UI does not estimate it from context-window size.

## Notes

- Interface observed on 2026-09-11.
- Conversation content, projects, and local app metadata stay on this Mac.
- The session list and labels may change as Claude Code creates or stops sessions.

## Screenshots

![Desktop conversation with token usage breakdown](../images/token-usage-desktop.png)

![Mobile conversation with token usage breakdown](../images/token-usage-mobile.png)
