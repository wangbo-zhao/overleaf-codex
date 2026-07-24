# Usage Guide

[简体中文](USAGE.zh-CN.md)

## Basic workflow

1. Start the bridge with `npm start`.
2. Open an Overleaf project in the source editor.
3. Press `Command/Ctrl + Shift + K` to open or focus Overleaf Codex.
4. Ask a question, optionally with file/line references or an `@plugin`.
5. Review Codex’s answer, tool activity, and any replacement candidates.
6. Apply a candidate only after checking its diff.

Opening the chat does not automatically capture a selection.

## Add references

Select text in the Overleaf source editor, or leave the cursor on a line, then
press:

- macOS: `Command + Shift + I`
- Windows/Linux: `Ctrl + Shift + I`

Each use adds a separate reference card containing the project-relative path and
1-based line range. Repeat the shortcut to add references from multiple files or
multiple ranges in the same file.

References remain above the composer for follow-up questions until you remove
them or start a new conversation. Files explicitly added from the `+` menu are
treated as one-turn priority context and are cleared after a successful send.

References are context, not edit instructions. Codex should only return
replacement candidates when your message explicitly asks for a change.

## Chat controls

- `Enter`: send
- `Shift + Enter`: insert a new line
- Up-arrow send button: send the current message
- Square stop button: interrupt the active turn when the composer is empty
- History icon: open project-grouped chat history
- Pencil icon: start a new conversation
- Gear icon: open bridge, directory, and shortcut settings
- Maximize icon: maximize or restore
- Drag the title bar: move the window
- Drag an edge or corner: resize the window

## Model and reasoning effort

Use the selector at the lower-right of the composer. The extension asks the
local Codex App Server for visible models and the reasoning efforts supported by
each model.

Changing the selector during an active turn affects the next turn, not the one
already running.

## Plugins with `@`

Type `@` in the composer to search locally installed and enabled Codex plugins.
Select a plugin from the menu, then describe the task.

The extension does not install, enable, or authenticate plugins. Perform those
operations in a supported Codex surface, then refresh the plugin list in
Overleaf Codex. Restarting the bridge may be required after plugin changes.

Plugin tools can request:

- command approval;
- permission changes;
- OAuth or login actions;
- structured or free-form user input.

Review every request. A plugin may send relevant project content to the external
service it connects to.

## Project synchronization

The first turn for a project creates a complete local mirror. Later syncs use
Overleaf history versions and download only changed blobs when needed.

Current flow:

```text
Editing stops for about 1.5 seconds
        ↓
Silent background pre-sync
        ↓
Send or explicit Steer
        ↓
Final flush + non-waiting version probe
        ↓
Fetch/apply incremental changes only when the remote version is newer
        ↓
Start Codex with the validated local project mirror as cwd
```

If the project changes during final synchronization, the extension retries
until it sees a stable edit generation. It stops instead of silently falling
back to a stale or unverified project.

## Steer an active turn

Messages sent while Codex is working appear as pending cards.

- Select **Steer** to synchronize the latest project state and inject the
  message into the active turn.
- Leave the card pending to send it automatically as a new turn after the
  current turn completes.
- Delete the pending card to discard it.

An explicit Steer always performs a final project check before calling
`turn/steer`.

## Read responses

Assistant messages support:

- Markdown headings, lists, links, code, and tables;
- inline math with `$...$` or `\\(...\\)`;
- display math with `$$...$$` or `\\[...\\]`;
- streamed reasoning summaries and commentary;
- tool and local-command status;
- approval and input cards.

Raw HTML from model output is not rendered.

## Replacement candidates

When you explicitly ask Codex to modify referenced text, it can return one or
more candidates. Each candidate may provide:

- **View diff**: inspect word-level changes;
- **Copy**: copy the replacement;
- **Apply to Overleaf**: update the referenced range;
- **Undo apply**: restore the pre-apply content.

For multiple references, candidates are grouped by file and line range.

Before applying or undoing, the extension checks that the expected text and
nearby anchors still match. If you or a collaborator changed the target, the
operation is rejected rather than overwriting newer work.

## History

The history panel groups conversations by Overleaf project.

- The current project appears first.
- Open a previous conversation to review or continue it.
- Conversations from another project are read-only until that project is open.
- Deletion is explicit and permanent.
- Opening or closing history does not interrupt a running Codex turn.

History is local to this extension and does not appear in the normal Codex app
history list.

## Settings

The in-chat settings control:

- bridge URL and token;
- chat-history directory;
- project-mirror directory;
- shortcut-management link.

Changing a data directory copies existing data and retains the old directory as
a backup.

## Suggested prompts

Analyze without editing:

```text
Explain the relationship between the two referenced equations. Do not modify files.
```

Review a section:

```text
Check the referenced section for unsupported claims and LaTeX issues. Report findings first; do not rewrite unless I ask.
```

Request multiple alternatives:

```text
Rewrite each referenced passage in two versions: concise and formal. Preserve all LaTeX commands, citations, labels, and numerical claims.
```

Project-wide question:

```text
Inspect the project and list every equation label that is never referenced.
```

Use a plugin:

```text
@plugin-name Follow the plugin workflow for the referenced section.
```

## Safety reminders

- Review diffs before applying.
- Do not share bridge tokens, Overleaf cookies, or private project content in
  public issues.
- Review plugin data handling before using it with confidential work.
- Keep the bridge bound to loopback; do not expose port `47831` to a network.
- Back up important projects and histories before changing storage directories.
