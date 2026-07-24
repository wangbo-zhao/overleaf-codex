# Installation Guide

[简体中文](INSTALL.zh-CN.md)

This guide installs the local bridge and the unpacked Chrome extension from
source.

## 1. Prerequisites

Install:

- Chrome 111 or newer
- Node.js 20 or newer
- npm (included with Node.js)
- Codex CLI

Verify Node.js:

```bash
node --version
npm --version
```

Install Codex CLI and sign in:

```bash
npm install --global @openai/codex
codex --version
codex login
codex login status
```

`codex login` opens a browser sign-in flow. On a headless machine, the official
CLI also supports `codex login --device-auth`. See the official
[Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) and
[authentication documentation](https://learn.chatgpt.com/docs/auth).

## 2. Download the source

Clone the repository:

```bash
git clone <repository-url>
cd overleaf-codex
```

Alternatively, download the source archive from the repository’s Releases page
and extract it.

## 3. Install dependencies

For a reproducible install:

```bash
npm ci
```

The post-install step prepares local Markdown and KaTeX assets under
`extension/vendor/`. The browser extension does not load these libraries from a
CDN.

Verify the checkout:

```bash
npm run check
npm test
```

## 4. Start the local bridge

```bash
npm start
```

The bridge:

- listens on `http://127.0.0.1:47831`;
- creates a random token at `~/.overleaf-codex/token`;
- prints the token on first start; and
- locates Codex from `PATH`, common macOS application locations, or an explicit
  environment variable.

Keep this terminal open while using the extension.

To print the existing token:

```bash
npm run show-token
```

Treat the token as a local secret. Do not paste it into issues, screenshots, or
logs.

### Explicit Codex executable

If the bridge cannot find Codex, provide its absolute path:

```bash
OVERLEAF_CODEX_COMMAND="/absolute/path/to/codex" npm start
```

On macOS, a common bundled location is:

```bash
OVERLEAF_CODEX_COMMAND="/Applications/ChatGPT.app/Contents/Resources/codex" npm start
```

Windows PowerShell example:

```powershell
$env:OVERLEAF_CODEX_COMMAND = "C:\path\to\codex.exe"
npm start
```

## 5. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the repository’s `extension` directory.
5. Pin **Overleaf Codex** from Chrome’s extensions menu if desired.

When source files change, return to `chrome://extensions` and click **Reload**.
Refresh any already-open Overleaf tabs after reloading.

## 6. Connect the extension

1. Open an Overleaf project.
2. Switch to the source editor.
3. Press `Command + Shift + K` on macOS or `Ctrl + Shift + K` on
   Windows/Linux.
4. Open the gear menu.
5. Enter:
   - Bridge URL: `http://127.0.0.1:47831`
   - Bridge token: the value printed by `npm start`
6. Select **Test connection**, then save.

The initial project sync downloads a complete ZIP. Later requests use
incremental history and changed blobs.

## 7. Optional directories

The defaults are:

```text
Project mirrors: ~/.overleaf-codex/codex-workspace/
Chat history:    ~/.codex/sessions/overleaf-codex/
Bridge token:    ~/.overleaf-codex/token
```

The project mirror and history directories can be changed in the in-chat
settings. Existing data is copied to the new location; the previous directory
is retained as a backup.

## 8. Customize shortcuts

The defaults are:

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Open/focus chat | `Command + Shift + K` | `Ctrl + Shift + K` |
| Add selection/line reference | `Command + Shift + I` | `Ctrl + Shift + I` |

Open the in-chat settings and choose the shortcut-management link, or visit:

```text
chrome://extensions/shortcuts
```

## 9. Package the extension

```bash
npm run package:extension
```

Output:

```text
dist/overleaf-codex-extension.zip
```

## Updating

```bash
git pull
npm ci
npm run check
npm test
```

Restart the bridge, reload the extension at `chrome://extensions`, and refresh
Overleaf.

## Uninstalling

1. Remove Overleaf Codex from `chrome://extensions`.
2. Stop the bridge terminal.
3. Delete the source checkout if no longer needed.
4. Optionally remove local state:

```text
~/.overleaf-codex/
~/.codex/sessions/overleaf-codex/
```

Deleting those directories removes local mirrors, the bridge token, and chat
history. Back up anything you want to keep first.

## Troubleshooting

### `spawn codex ENOENT`

The bridge cannot find the Codex executable. Confirm `codex --version` works in
the same shell, or set `OVERLEAF_CODEX_COMMAND`.

### Bridge unavailable

Confirm `npm start` is still running, the URL is
`http://127.0.0.1:47831`, and the saved token matches
`npm run show-token`.

### Shortcut does nothing

Check `chrome://extensions/shortcuts`, resolve any conflict, and make sure the
active tab is an Overleaf project using the source editor.

### Project synchronization fails

Refresh Overleaf, confirm you are signed in and have project access, then retry.
Overleaf page or history API changes may require a project update.

### Math is not rendered

Run `npm ci` again, reload the extension, and confirm
`extension/vendor/katex/` exists.
