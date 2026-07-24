# Security Policy

## Reporting a vulnerability

Do not report security vulnerabilities in public issues.

Use the repository’s **Security → Report a vulnerability** workflow to open a
private GitHub security advisory. Include:

- affected version and operating system;
- the smallest safe reproduction;
- expected and observed behavior;
- impact;
- suggested remediation, if known.

Do not include real Overleaf cookies, bridge tokens, private project text,
OpenAI credentials, or third-party plugin secrets. Replace them with synthetic
values.

Maintainers should acknowledge a complete report within seven days and provide
status updates until remediation or disclosure.

## Security boundaries

- The bridge is designed to bind only to `127.0.0.1`.
- Every bridge request requires a random bearer token.
- Overleaf cookies and CSRF values must remain in browser-originated same-origin
  requests.
- Project mirrors and chat history are local files and may contain confidential
  content.
- Plugins may communicate with external services under their own policies.
- Overleaf page internals and history endpoints are not a stable public API.

Do not deploy the bridge on a public interface or reverse proxy without an
independent security review and a stronger authentication design.

## Supported versions

Security fixes are made on the latest release. Older releases may not receive
backports.

---

## 中文说明

请勿在公开 Issue 中报告安全漏洞。使用仓库的
**Security → Report a vulnerability** 创建私有 GitHub Security Advisory。
报告中不要附带真实的 Overleaf Cookie、桥接 Token、私有论文正文、OpenAI
凭据或插件密钥。

桥接服务设计为仅监听 `127.0.0.1` 并要求随机 Bearer Token。项目镜像和聊天
历史可能包含机密内容。未经独立安全审查和更强认证设计，请勿把桥接暴露到公网
或反向代理之后。
