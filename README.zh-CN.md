# Overleaf Codex

<p align="center">
  <img src="extension/icons/icon128.png" width="112" alt="Overleaf Codex 图标">
</p>

<p align="center">
  一个非官方 Chrome 扩展：在 Overleaf 源码编辑器中直接使用 Codex 对话、
  项目上下文、文件/行号引用和安全的 LaTeX 修改。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="docs/INSTALL.zh-CN.md">安装指南</a> ·
  <a href="docs/USAGE.zh-CN.md">使用指南</a> ·
  <a href="docs/PUBLISHING.md">发布清单</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

> [!IMPORTANT]
> Overleaf Codex 是独立的社区项目，与 OpenAI、Overleaf 不存在隶属、授权、
> 赞助或官方合作关系。“OpenAI”“Codex”和“Overleaf”均为其各自权利人的商标。

## 它解决什么问题

Overleaf Codex 由两个本地组件组成：

1. 运行在 `overleaf.com` 页面中的 Chrome Manifest V3 扩展；
2. 仅监听本机回环地址的 Node.js 桥接服务，用于连接本机已经登录的 Codex。

扩展会把当前 Overleaf 项目镜像到隔离的本地工作区，并把该工作区作为
Codex 的工作目录。Codex 因而可以像查看普通本地项目一样列目录、搜索和读取
文件，不需要把整个论文复制进提示词。

```text
Overleaf 源码编辑器
        │
        │ 当前浏览器登录会话
        ▼
Chrome 扩展 ── 带随机 Token 的本机 HTTP ── 本机桥接服务
        │                                          │
        │ 增量同步项目                              │ Codex App Server
        ▼                                          ▼
本地项目镜像 ◄───────────────────────────────── Codex CLI
```

## 主要功能

- 使用 `Command/Ctrl + Shift + K` 打开或聚焦聊天窗口。
- 使用 `Command/Ctrl + Shift + I` 连续添加多个文件/行号引用。
- 在输入器和历史消息中显示 VS Code 风格引用卡片。
- 编辑停止片刻后自动进行静默预同步。
- 每次普通消息和显式 `Steer` 前执行最终增量版本校验。
- 让 Codex 使用常规文件系统工具读取完整项目镜像。
- 在聊天界面选择 Codex 模型和该模型支持的推理强度。
- 输入 `@` 使用本机已经安装并启用的 Codex 插件。
- 流式展示推理摘要、commentary、工具调用与审批请求。
- 本地渲染 Markdown 和 KaTeX 数学公式。
- 支持多个修改候选；每个候选均可查看差异、复制、应用和撤销。
- 按 Overleaf 项目分组保存本地历史会话。
- 支持移动、缩放、最大化和还原浮动聊天窗口。

## 运行要求

- Chrome 111 或更高版本
- Node.js 20 或更高版本
- 已在本机安装并登录的 Codex CLI
- 已登录的 Overleaf 账号
- Overleaf 源码编辑器（当前不支持 Visual Editor）

安装并登录 Codex CLI：

```bash
npm install --global @openai/codex
codex login
codex login status
```

最新安装和登录方式请参考官方
[Codex CLI 文档](https://learn.chatgpt.com/docs/codex/cli)与
[身份验证文档](https://learn.chatgpt.com/docs/auth)。

## 快速开始

```bash
git clone <仓库地址>
cd overleaf-codex
npm ci
npm run check
npm test
npm start
```

使用期间请保持桥接终端运行。桥接服务只监听 `127.0.0.1:47831`，并把随机
Token 保存到 `~/.overleaf-codex/token`。

然后：

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择仓库中的 `extension` 文件夹。
4. 打开 Overleaf 项目并切换到源码编辑器。
5. 按 `Command/Ctrl + Shift + K`。
6. 打开聊天窗口内的设置，粘贴桥接 Token 并测试连接。

完整安装和排错步骤见[安装指南](docs/INSTALL.zh-CN.md)，完整工作流见
[使用指南](docs/USAGE.zh-CN.md)。

## 隐私与安全模型

- 桥接服务只绑定本机回环地址，并要求随机 Bearer Token。
- Overleaf Cookie 和 CSRF 信息只用于浏览器同源请求，不会发送给本机桥接，
  也不会写入 Codex 提示词。
- 项目默认镜像到 `~/.overleaf-codex/codex-workspace/`。
- 聊天历史默认保存在 `~/.codex/sessions/overleaf-codex/`。
- Chrome 扩展不会保存 OpenAI API Key。
- 选中的插件可能把相关内容发送到其连接的第三方服务。敏感项目使用插件前，
  请先检查插件的数据处理方式。
- 自动写回前会验证原文和相邻锚点，降低覆盖较新编辑的风险。

部署或修改桥接服务前，请阅读 [SECURITY.md](SECURITY.md)。

## 开发与验证

```bash
npm ci
npm run check
npm test
npm run package:extension
```

打包结果位于：

```text
dist/overleaf-codex-extension.zip
```

主要目录：

```text
extension/   Chrome 扩展 UI、Overleaf 适配和同步协调
bridge/      本机 HTTP 服务、Codex App Server 客户端、历史和工作区存储
scripts/     依赖资源准备、验证与打包脚本
tests/       Node.js 回归测试和 Overleaf 页面夹具
```

## 已知限制

- Overleaf 没有公开的第三方编辑器扩展 API。本项目依赖当前页面内部结构和
  历史接口，这些内容可能在没有通知的情况下变化。
- 当前只支持源码编辑器。
- 首次同步需要下载完整项目 ZIP，后续同步使用增量记录。
- Codex 插件发现目前依赖实验性的 Codex App Server 能力。
- 扩展会创建独立的 Codex thread，不能连接到已经打开的 Codex 桌面对话。
- 复杂的插件专用 MCP 界面可能降级为基础文本或审批控件。

## 参与贡献

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)
并遵守[行为准则](CODE_OF_CONDUCT.md)。Issue 中不要附带私有 Overleaf 内容、
桥接 Token、Cookie 或其他凭据。

## 许可证与商标

源代码使用 [MIT License](LICENSE)。该许可证不授予任何 OpenAI 或 Overleaf
商标权利，详见 [TRADEMARKS.md](TRADEMARKS.md) 和
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
