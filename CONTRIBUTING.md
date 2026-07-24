# Contributing

Thank you for helping improve Overleaf Codex.

## Before opening an issue

- Search existing issues first.
- Reproduce the problem with the latest `main` branch.
- Remove private paper text, project IDs, bridge tokens, cookies, local paths,
  account details, and plugin credentials.
- For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a
  public issue.

## Development setup

Fork the repository on GitHub, then clone your fork:

```bash
git clone git@github.com:<your-account>/overleaf-codex.git
cd overleaf-codex
npm ci
npm run release:check
```

Load the `extension` directory as an unpacked extension in Chrome. Start the
bridge with `npm start`, then use a test Overleaf project that contains no
confidential content.

## Pull requests

1. Keep each pull request focused on one problem.
2. Explain user-visible behavior and synchronization or privacy implications.
3. Add or update regression tests.
4. Run `npm run release:check`.
5. Update English and Chinese user documentation when behavior changes.
6. Do not commit generated `node_modules/`, `extension/vendor/`, `dist/`, local
   tokens, project mirrors, or conversation history.

## Design principles

- The extension is a user interface and synchronization layer; reasoning and
  tool use belong to Codex.
- A file reference is context, not an implicit editing request.
- Never start a turn against a project mirror that failed final version
  validation.
- Prefer incremental, hash-verified synchronization over full downloads.
- Reject stale write-back rather than overwriting newer Overleaf content.
- Keep Overleaf credentials inside same-origin browser requests.
- Keep the bridge loopback-only and token-authenticated.
- Preserve normal Codex plugin, model, approval, and sandbox semantics.

## Code style

- Use modern JavaScript and ES modules.
- Prefer small, testable functions.
- Preserve existing plain-JavaScript architecture unless a migration is
  discussed first.
- Use `node --check`, the existing test suite, and `git diff --check`.
- Keep UI strings concise. When adding important user-facing documentation,
  update both English and Simplified Chinese guides.

## Commit messages

Use an imperative summary, for example:

```text
Fix final sync validation after background pre-sync
```

## Community

Be respectful and follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## 中文说明

提交 Issue 或 Pull Request 前，请先搜索现有问题、使用最新 `main` 复现，并删除
论文正文、项目 ID、桥接 Token、Cookie、本机路径和账号信息。安全漏洞请按
[SECURITY.md](SECURITY.md) 私下报告。

提交代码时请保持改动聚焦，补充回归测试，运行 `npm run release:check`，并在
行为变化时同步更新中英文文档。不要提交 `node_modules/`、
`extension/vendor/`、`dist/`、本地 Token、项目镜像或聊天历史。
