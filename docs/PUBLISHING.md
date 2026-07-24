# Publishing Checklist / 开源发布清单

## English

This desktop export starts with a fresh Git history and is intended to become
the public repository.

Before publishing:

1. Create an empty GitHub repository named `overleaf-codex`.
2. Replace `<repository-url>`, `<your-fork-url>`, and `<仓库地址>` placeholders
   in the documentation with the final public URL.
3. Add package metadata such as `repository`, `homepage`, and `bugs` to
   `package.json` after the URL is known.
4. Re-evaluate the name and icon under
   [TRADEMARKS.md](../TRADEMARKS.md). Distinct community branding reduces the
   risk of implying official affiliation.
5. Run:

   ```bash
   npm ci
   npm run release:check
   ```

6. Scan the staged repository for:
   - bridge tokens;
   - cookies and credentials;
   - private project text or IDs;
   - personal absolute paths;
   - generated mirrors and conversation history.
7. Push the clean repository:

   ```bash
   git remote add origin <repository-url>
   git push -u origin main
   ```

8. Confirm GitHub Actions passes.
9. Enable private vulnerability reporting in the repository security settings.
10. Create a `v1.7.0` release and attach
    `dist/overleaf-codex-extension.zip`.

Recommended repository settings:

- require pull requests and passing CI before merging to `main`;
- enable Dependabot alerts and security updates;
- enable Issues;
- add clear topics such as `chrome-extension`, `codex`, `latex`, and
  `overleaf`;
- keep the unofficial-project disclaimer visible.

The extension relies on Overleaf page internals and experimental Codex App
Server capabilities. State this clearly in release notes and avoid promising
compatibility with future upstream versions.

## 中文

这个桌面副本使用全新的 Git 历史，适合作为公开仓库的起点。

发布前：

1. 创建一个名为 `overleaf-codex` 的空 GitHub 仓库。
2. 把文档中的 `<repository-url>`、`<your-fork-url>` 和 `<仓库地址>` 替换为
   最终公开地址。
3. 地址确定后，在 `package.json` 中补充 `repository`、`homepage` 和 `bugs`。
4. 根据 [TRADEMARKS.md](../TRADEMARKS.md) 再次评估项目名称和图标。采用可区分
   的社区品牌可以降低用户误认为官方产品的风险。
5. 运行：

   ```bash
   npm ci
   npm run release:check
   ```

6. 扫描暂存内容，确认不含：
   - 桥接 Token；
   - Cookie 和其他凭据；
   - 私有项目正文或项目 ID；
   - 个人绝对路径；
   - 生成的项目镜像和聊天历史。
7. 推送干净仓库：

   ```bash
   git remote add origin <repository-url>
   git push -u origin main
   ```

8. 确认 GitHub Actions 通过。
9. 在仓库安全设置中启用私有漏洞报告。
10. 创建 `v1.7.0` Release，并附加
    `dist/overleaf-codex-extension.zip`。

建议开启 `main` 分支保护、合并前 CI、Dependabot、Issues，并添加
`chrome-extension`、`codex`、`latex`、`overleaf` 等 topics。始终保留醒目的
非官方项目声明。

本扩展依赖 Overleaf 页面内部实现和实验性的 Codex App Server 能力。请在
Release Notes 中明确说明，不要承诺与未来上游版本永久兼容。
