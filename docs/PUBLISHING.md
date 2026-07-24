# Publishing Checklist / 开源发布清单

## English

The public repository is
[`wangbo-zhao/overleaf-codex`](https://github.com/wangbo-zhao/overleaf-codex).

Before publishing a release:

1. Re-evaluate the name and icon under
   [TRADEMARKS.md](../TRADEMARKS.md). Distinct community branding reduces the
   risk of implying official affiliation.
2. Run:

   ```bash
   npm ci
   npm run release:check
   ```

3. Scan the staged repository for:
   - bridge tokens;
   - cookies and credentials;
   - private project text or IDs;
   - personal absolute paths;
   - generated mirrors and conversation history.
4. Push the clean repository:

   ```bash
   git remote add origin git@github.com:wangbo-zhao/overleaf-codex.git
   git push -u origin main
   ```

5. Confirm GitHub Actions passes.
6. Enable private vulnerability reporting in the repository security settings.
7. Create a `v1.7.0` release and attach
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

公开仓库为
[`wangbo-zhao/overleaf-codex`](https://github.com/wangbo-zhao/overleaf-codex)。

发布新版本前：

1. 根据 [TRADEMARKS.md](../TRADEMARKS.md) 再次评估项目名称和图标。采用可区分
   的社区品牌可以降低用户误认为官方产品的风险。
2. 运行：

   ```bash
   npm ci
   npm run release:check
   ```

3. 扫描暂存内容，确认不含：
   - 桥接 Token；
   - Cookie 和其他凭据；
   - 私有项目正文或项目 ID；
   - 个人绝对路径；
   - 生成的项目镜像和聊天历史。
4. 推送干净仓库：

   ```bash
   git remote add origin git@github.com:wangbo-zhao/overleaf-codex.git
   git push -u origin main
   ```

5. 确认 GitHub Actions 通过。
6. 在仓库安全设置中启用私有漏洞报告。
7. 创建 `v1.7.0` Release，并附加
    `dist/overleaf-codex-extension.zip`。

建议开启 `main` 分支保护、合并前 CI、Dependabot、Issues，并添加
`chrome-extension`、`codex`、`latex`、`overleaf` 等 topics。始终保留醒目的
非官方项目声明。

本扩展依赖 Overleaf 页面内部实现和实验性的 Codex App Server 能力。请在
Release Notes 中明确说明，不要承诺与未来上游版本永久兼容。
