const DEFAULTS = {
  bridgeUrl: "http://127.0.0.1:47831",
  bridgeToken: "",
  model: "",
  reasoningEffort: "",
};

const bridgeUrl = document.querySelector("#bridgeUrl");
const bridgeToken = document.querySelector("#bridgeToken");
const historyDirectory = document.querySelector("#historyDirectory");
const historyDirectoryHint = document.querySelector("#historyDirectoryHint");
const workspaceDirectory = document.querySelector("#workspaceDirectory");
const workspaceDirectoryHint = document.querySelector("#workspaceDirectoryHint");
const status = document.querySelector("#status");

initialize();

document.querySelector("#save").addEventListener("click", save);
document.querySelector("#test").addEventListener("click", testConnection);
document.querySelector("#resetHistoryDirectory").addEventListener("click", () => {
  historyDirectory.value = "";
  historyDirectory.focus();
});
document.querySelector("#resetWorkspaceDirectory").addEventListener("click", () => {
  workspaceDirectory.value = "";
  workspaceDirectory.focus();
});
document.querySelector("#reveal").addEventListener("click", (event) => {
  const visible = bridgeToken.type === "text";
  bridgeToken.type = visible ? "password" : "text";
  event.currentTarget.textContent = visible ? "显示" : "隐藏";
});

async function initialize() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  bridgeUrl.value = settings.bridgeUrl;
  bridgeToken.value = settings.bridgeToken;
  try {
    const [historyResponse, workspaceResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: "history_config_get" }),
      chrome.runtime.sendMessage({ type: "workspace_config_get" }),
    ]);
    if (!historyResponse.ok) throw new Error(historyResponse.error);
    if (!workspaceResponse.ok) throw new Error(workspaceResponse.error);
    applyHistoryConfig(historyResponse.result);
    applyWorkspaceConfig(workspaceResponse.result);
  } catch {
    historyDirectory.placeholder = "~/.codex/sessions/overleaf-codex";
    historyDirectoryHint.textContent =
      "启动桥接服务后可读取或修改目录；留空使用 Codex 默认目录。";
    workspaceDirectory.placeholder = "~/.overleaf-codex/codex-workspace";
    workspaceDirectoryHint.textContent =
      "启动桥接服务后可读取或修改目录；留空使用默认目录。";
  }
}

async function save() {
  try {
    const url = validateUrl(bridgeUrl.value);
    const connectionResponse = await chrome.runtime.sendMessage({
      type: "save_connection_settings",
      bridgeUrl: url,
      bridgeToken: bridgeToken.value.trim(),
    });
    if (!connectionResponse.ok) throw new Error(connectionResponse.error);
    if (bridgeToken.value.trim()) {
      const [historyResponse, workspaceResponse] = await Promise.all([
        chrome.runtime.sendMessage({
          type: "history_config_set",
          directory: historyDirectory.value.trim(),
        }),
        chrome.runtime.sendMessage({
          type: "workspace_config_set",
          directory: workspaceDirectory.value.trim(),
        }),
      ]);
      if (!historyResponse.ok) throw new Error(historyResponse.error);
      if (!workspaceResponse.ok) throw new Error(workspaceResponse.error);
      applyHistoryConfig(historyResponse.result);
      applyWorkspaceConfig(workspaceResponse.result);
    }
    showStatus("设置已保存。", "success");
    return true;
  } catch (error) {
    showStatus(error.message, "error");
    return false;
  }
}

async function testConnection() {
  if (!(await save())) return;
  if (!bridgeToken.value.trim()) {
    showStatus("请先填写桥接 Token。", "error");
    return;
  }
  showStatus("正在连接…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "bridge_request",
      request: { method: "GET", path: "/v1/health" },
    });
    if (!response.ok) throw new Error(response.error);
    showStatus(
      `连接成功，桥接服务版本 ${response.result.version}。`,
      "success",
    );
  } catch (error) {
    showStatus(`连接失败：${error.message}`, "error");
  }
}

function validateUrl(value) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("桥接地址必须是本机 HTTP 地址。");
  }
  return url.origin;
}

function applyHistoryConfig(config) {
  historyDirectory.value = config.isDefault ? "" : config.directory;
  historyDirectory.placeholder = config.defaultDirectory;
  historyDirectoryHint.textContent = `历史文件：${config.filePath}`;
}

function applyWorkspaceConfig(config) {
  workspaceDirectory.value = config.isDefault ? "" : config.directory;
  workspaceDirectory.placeholder = config.defaultDirectory;
  workspaceDirectoryHint.textContent = `项目镜像目录：${config.directory}`;
}

function showStatus(message, type = "") {
  status.textContent = message;
  status.className = type;
}
