# Overleaf Codex

<p align="center">
  <img src="extension/icons/icon128.png" width="112" alt="Overleaf Codex icon">
</p>

<p align="center">
  An unofficial Chrome extension that brings Codex conversations, project context,
  file/line references, and safe LaTeX edits into the Overleaf source editor.
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="docs/INSTALL.md">Installation</a> ·
  <a href="docs/USAGE.md">Usage</a> ·
  <a href="docs/PUBLISHING.md">Publishing</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

> [!IMPORTANT]
> Overleaf Codex is an independent community project. It is not affiliated with,
> endorsed by, or sponsored by OpenAI or Overleaf. “OpenAI,” “Codex,” and
> “Overleaf” are trademarks of their respective owners.

## What it does

Overleaf Codex is a local integration made of:

1. a Chrome Manifest V3 extension running on `overleaf.com`; and
2. a loopback-only Node.js bridge that connects the extension to your locally
   authenticated Codex installation.

The extension mirrors the current Overleaf project into an isolated local
workspace. Codex receives that workspace as its working directory, so it can
inspect the project like a normal local repository instead of receiving a huge
copy-pasted prompt.

```text
Overleaf source editor
        │
        │ current browser session
        ▼
Chrome extension ── token-authenticated localhost HTTP ── Local bridge
        │                                                    │
        │ incremental project sync                           │ Codex App Server
        ▼                                                    ▼
Local project mirror ◄────────────────────────────────── Codex CLI
```

## Highlights

- Open or focus the chat with `Command/Ctrl + Shift + K`.
- Add one or more file/line references with `Command/Ctrl + Shift + I`.
- Keep references visible as VS Code-style cards in both the composer and chat.
- Automatically pre-sync edits after a short idle period.
- Perform a final incremental version check before every turn and explicit
  `Steer`.
- Let Codex inspect the complete mirrored project with normal filesystem tools.
- Select the Codex model and supported reasoning effort in the chat UI.
- Mention installed Codex plugins with `@`.
- Show streamed reasoning summaries, commentary, tool activity, and approvals.
- Render Markdown and KaTeX math locally.
- Return multiple replacement candidates, each with diff, copy, apply, and undo.
- Group history by Overleaf project and store it locally.
- Move and resize the floating chat window.

## Requirements

- Chrome 111 or newer
- Node.js 20 or newer
- A locally installed and authenticated Codex CLI
- An authenticated Overleaf account
- The Overleaf source editor (Visual Editor is not currently supported)

Codex CLI can be installed with:

```bash
npm install --global @openai/codex
codex login
codex login status
```

See the official [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli)
and [authentication documentation](https://learn.chatgpt.com/docs/auth) for
current installation and sign-in options.

## Quick start

```bash
git clone <repository-url>
cd overleaf-codex
npm ci
npm run check
npm test
npm start
```

Keep the bridge terminal open. It listens only on `127.0.0.1:47831` and creates
a random token at `~/.overleaf-codex/token`.

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository’s `extension` folder.
4. Open an Overleaf project in the source editor.
5. Press `Command/Ctrl + Shift + K`.
6. Open the in-chat settings, paste the bridge token, and test the connection.

For complete setup and troubleshooting, read
[Installation](docs/INSTALL.md). For the full workflow, read
[Usage](docs/USAGE.md).

## Privacy and security model

- The bridge binds to loopback only and requires a random bearer token.
- Overleaf cookies and CSRF data remain in browser-originated requests; they are
  not sent to the local bridge or inserted into Codex prompts.
- Project content is mirrored locally under
  `~/.overleaf-codex/codex-workspace/` by default.
- Chat history is stored locally under
  `~/.codex/sessions/overleaf-codex/` by default.
- The Chrome extension does not store an OpenAI API key.
- Selected plugins may send relevant content to third-party services they
  connect to. Review each plugin before using it with sensitive projects.
- Automatic write-back validates the original text and surrounding anchors
  before changing Overleaf, reducing the risk of overwriting newer edits.

Read [SECURITY.md](SECURITY.md) before deploying or modifying the bridge.

## Development

```bash
npm ci
npm run check
npm test
npm run package:extension
```

The packaged extension is written to:

```text
dist/overleaf-codex-extension.zip
```

Important source areas:

```text
extension/   Chrome extension UI, Overleaf adapter, and sync coordinator
bridge/      Local HTTP service, Codex App Server client, history/workspace stores
scripts/     Asset preparation, validation, and packaging
tests/       Node.js regression tests and Overleaf fixtures
```

## Known limitations

- Overleaf does not provide a public third-party editor-extension API. This
  project relies on current Overleaf page internals and history endpoints, which
  may change without notice.
- Only the source editor is supported.
- The first sync downloads a complete project ZIP; later syncs are incremental.
- Codex plugin discovery currently depends on experimental Codex App Server
  capabilities.
- The extension starts an independent Codex thread; it cannot attach to an
  already-open Codex desktop conversation.
- Complex plugin-specific MCP interfaces may fall back to basic text or approval
  controls.

## Contributing

Issues and pull requests are welcome. Please read
[CONTRIBUTING.md](CONTRIBUTING.md), follow the
[Code of Conduct](CODE_OF_CONDUCT.md), and avoid including private Overleaf
content, bridge tokens, cookies, or credentials in reports.

## License and trademarks

Source code is available under the [MIT License](LICENSE). The license does not
grant rights to OpenAI or Overleaf trademarks. See [TRADEMARKS.md](TRADEMARKS.md)
and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
