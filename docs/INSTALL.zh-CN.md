# 安装指南

[English](INSTALL.md)

本指南介绍如何从源码安装本机桥接服务和 Chrome 扩展。

## 1. 准备环境

需要安装：

- Chrome 111 或更高版本
- Node.js 20 或更高版本
- npm（随 Node.js 提供）
- Codex CLI

检查 Node.js：

```bash
node --version
npm --version
```

安装并登录 Codex CLI：

```bash
npm install --global @openai/codex
codex --version
codex login
codex login status
```

`codex login` 会打开浏览器登录流程。在无图形界面的设备上，官方 CLI 还支持
`codex login --device-auth`。最新说明见官方
[Codex CLI 文档](https://learn.chatgpt.com/docs/codex/cli)和
[身份验证文档](https://learn.chatgpt.com/docs/auth)。

## 2. 获取源码

克隆仓库：

```bash
git clone https://github.com/wangbo-zhao/overleaf-codex.git
cd overleaf-codex
```

也可以从仓库 Releases 页面下载源码压缩包并解压。

## 3. 安装依赖

建议使用可复现安装：

```bash
npm ci
```

安装后的脚本会把 Markdown 和 KaTeX 资源准备到 `extension/vendor/`。浏览器
扩展不会从 CDN 加载这些库。

验证代码：

```bash
npm run check
npm test
```

## 4. 启动本机桥接服务

```bash
npm start
```

桥接服务会：

- 监听 `http://127.0.0.1:47831`；
- 在 `~/.overleaf-codex/token` 创建随机 Token；
- 首次启动时在终端显示 Token；
- 从 `PATH`、macOS 常见应用位置或指定的环境变量中寻找 Codex。

使用扩展期间需要保持这个终端运行。

单独显示已有 Token：

```bash
npm run show-token
```

请把 Token 当作本机密钥，不要放进 Issue、截图或公开日志。

### 手动指定 Codex 路径

如果桥接找不到 Codex，可提供可执行文件的绝对路径：

```bash
OVERLEAF_CODEX_COMMAND="/Codex/绝对路径" npm start
```

macOS 常见的应用内路径：

```bash
OVERLEAF_CODEX_COMMAND="/Applications/ChatGPT.app/Contents/Resources/codex" npm start
```

Windows PowerShell 示例：

```powershell
$env:OVERLEAF_CODEX_COMMAND = "C:\path\to\codex.exe"
npm start
```

## 5. 加载 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择仓库中的 `extension` 文件夹。
5. 如有需要，可从 Chrome 扩展菜单固定 Overleaf Codex。

源码更新后，回到 `chrome://extensions` 点击“重新加载”，然后刷新已经打开的
Overleaf 页面。

## 6. 连接扩展和桥接

1. 打开一个 Overleaf 项目。
2. 切换到源码编辑器。
3. macOS 按 `Command + Shift + K`，Windows/Linux 按
   `Ctrl + Shift + K`。
4. 打开齿轮设置。
5. 填写：
   - 桥接地址：`http://127.0.0.1:47831`
   - 桥接 Token：`npm start` 显示的值
6. 点击“测试连接”，然后保存。

首次同步会下载完整项目 ZIP，后续请求只读取增量历史和变化 blob。

## 7. 可选目录设置

默认位置：

```text
项目镜像：~/.overleaf-codex/codex-workspace/
聊天历史：~/.codex/sessions/overleaf-codex/
桥接 Token：~/.overleaf-codex/token
```

可以在聊天窗口的设置中修改项目镜像和历史目录。已有数据会复制到新位置，旧
目录会作为备份保留。

## 8. 自定义快捷键

默认快捷键：

| 操作 | macOS | Windows/Linux |
| --- | --- | --- |
| 打开/聚焦聊天 | `Command + Shift + K` | `Ctrl + Shift + K` |
| 添加选区/当前行引用 | `Command + Shift + I` | `Ctrl + Shift + I` |

可以在聊天设置中点击快捷键管理入口，或直接打开：

```text
chrome://extensions/shortcuts
```

## 9. 打包扩展

```bash
npm run package:extension
```

输出：

```text
dist/overleaf-codex-extension.zip
```

## 更新

```bash
git pull
npm ci
npm run check
npm test
```

然后重启桥接，在 `chrome://extensions` 重新加载扩展，并刷新 Overleaf。

## 卸载

1. 从 `chrome://extensions` 删除 Overleaf Codex。
2. 停止桥接终端。
3. 不再需要时删除源码目录。
4. 如需彻底删除本地状态，可删除：

```text
~/.overleaf-codex/
~/.codex/sessions/overleaf-codex/
```

删除这些目录会移除本地镜像、桥接 Token 和聊天历史，请先备份需要保留的内容。

## 常见问题

### `spawn codex ENOENT`

桥接找不到 Codex。请确认同一个终端中 `codex --version` 可以运行，或设置
`OVERLEAF_CODEX_COMMAND`。

### 无法连接桥接

确认 `npm start` 仍在运行，地址为 `http://127.0.0.1:47831`，并且设置中
的 Token 与 `npm run show-token` 一致。

### 快捷键没有反应

检查 `chrome://extensions/shortcuts` 是否存在冲突，并确认当前页面是
Overleaf 项目的源码编辑器。

### 项目同步失败

刷新 Overleaf，确认仍处于登录状态且拥有项目权限，然后重试。如果 Overleaf
页面或历史接口发生变化，可能需要等待项目更新。

### 数学公式没有渲染

重新运行 `npm ci`、重新加载扩展，并确认 `extension/vendor/katex/` 存在。
