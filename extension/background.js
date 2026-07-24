const DEFAULT_SETTINGS = {
  bridgeUrl: "http://127.0.0.1:47831",
  bridgeToken: "",
  model: "",
  reasoningEffort: "",
};
const CHAT_HISTORY_KEY = "overleafCodexChatHistoryV1";
const CHAT_HISTORY_MIGRATED_KEY = "overleafCodexHistoryMigratedToBridgeV1";
const ACTIVE_PROJECT_SYNCS = new Map();
const PROJECT_SYNC_STATE_CACHE = new Map();
const MAX_INCREMENTAL_SYNC_ROUNDS = 8;
const MAX_INCREMENTAL_CHANGE_PAGES = 10_000;
const BLOB_UPLOAD_CONCURRENCY = 6;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "open_from_shortcut" }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (!["open-codex-dialog", "add-selection-reference"].includes(command)) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs
    .sendMessage(tab.id, {
      type:
        command === "add-selection-reference"
          ? "add_reference_from_shortcut"
          : "open_from_shortcut",
    })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "capture_selection":
      return executeInPage(sender, captureOverleafSelection);
    case "capture_current_file":
      return executeInPage(sender, captureOverleafCurrentFile, [
        message.preferredEditorIndex,
      ]);
    case "get_overleaf_project_context":
      return getOverleafProjectContext(sender);
    case "sync_overleaf_project":
      return syncOverleafProject(sender, { purpose: "turn" });
    case "pre_sync_overleaf_project":
      return syncOverleafProject(sender, { purpose: "pre-sync" });
    case "apply_replacement":
      return executeInPage(sender, applyOverleafReplacement, [
        message.snapshot,
        message.replacement,
      ]);
    case "bridge_request":
      return bridgeRequest(message.request);
    case "get_settings":
      return chrome.storage.local.get(DEFAULT_SETTINGS);
    case "save_connection_settings": {
      const bridgeUrl = normalizeBridgeUrl(message.bridgeUrl);
      const bridgeToken =
        typeof message.bridgeToken === "string"
          ? message.bridgeToken.trim()
          : "";
      await chrome.storage.local.set({ bridgeUrl, bridgeToken });
      PROJECT_SYNC_STATE_CACHE.clear();
      return { saved: true, bridgeUrl };
    }
    case "save_preferences": {
      const model = typeof message.model === "string" ? message.model : "";
      const reasoningEffort =
        typeof message.reasoningEffort === "string" ? message.reasoningEffort : "";
      await chrome.storage.local.set({ model, reasoningEffort });
      return { saved: true };
    }
    case "get_shortcuts": {
      const commands = await chrome.commands.getAll();
      return {
        shortcuts: commands
          .filter((command) =>
            ["open-codex-dialog", "add-selection-reference"].includes(
              command.name,
            ),
          )
          .map((command) => ({
            name: command.name,
            description: command.description || "",
            shortcut: command.shortcut || "",
          })),
      };
    }
    case "open_shortcut_settings":
      await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      return { opened: true };
    case "chat_history_list":
      await migrateLegacyHistory();
      return bridgeRequest({ method: "GET", path: "/v1/history" });
    case "chat_history_save":
      return bridgeRequest({
        method: "POST",
        path: "/v1/history",
        body: { conversation: message.conversation },
      });
    case "chat_history_delete":
      return bridgeRequest({
        method: "DELETE",
        path: `/v1/history/${encodeURIComponent(String(message.id || ""))}`,
      });
    case "history_config_get":
      return bridgeRequest({ method: "GET", path: "/v1/history/config" });
    case "history_config_set":
      return bridgeRequest({
        method: "POST",
        path: "/v1/history/config",
        body: { directory: String(message.directory || "") },
      });
    case "workspace_config_get":
      return bridgeRequest({ method: "GET", path: "/v1/workspace/config" });
    case "workspace_config_set": {
      const workspaceConfig = await bridgeRequest({
        method: "POST",
        path: "/v1/workspace/config",
        body: { directory: String(message.directory || "") },
      });
      PROJECT_SYNC_STATE_CACHE.clear();
      return workspaceConfig;
    }
    case "open_options":
      await chrome.runtime.openOptionsPage();
      return { opened: true };
    default:
      throw new Error("Unknown extension message.");
  }
}

function getOverleafProjectContext(sender) {
  const tabUrl = new URL(String(sender.tab?.url || ""));
  if (
    tabUrl.protocol !== "https:" ||
    !(
      tabUrl.hostname === "overleaf.com" ||
      tabUrl.hostname.endsWith(".overleaf.com")
    )
  ) {
    throw new Error("当前页面不是受支持的 Overleaf 项目。");
  }
  const match = tabUrl.pathname.match(/^\/project\/([^/]+)/i);
  if (!match) throw new Error("无法从当前页面识别 Overleaf 项目。");
  const projectId = decodeURIComponent(match[1]).slice(0, 200);
  const title = String(sender.tab?.title || "")
    .replace(/\s+[-–—|]\s+Overleaf.*$/i, "")
    .replace(/\s+[-–—|]\s+Online LaTeX Editor.*$/i, "")
    .trim()
    .slice(0, 500);
  return {
    projectId,
    projectName: title || `Overleaf project ${projectId}`,
    origin: tabUrl.origin,
    workspaceId: `${tabUrl.origin}|${projectId}`,
  };
}

async function migrateLegacyHistory() {
  const stored = await chrome.storage.local.get({
    [CHAT_HISTORY_KEY]: [],
    [CHAT_HISTORY_MIGRATED_KEY]: false,
  });
  if (stored[CHAT_HISTORY_MIGRATED_KEY]) return;
  const conversations = Array.isArray(stored[CHAT_HISTORY_KEY])
    ? stored[CHAT_HISTORY_KEY]
    : [];
  if (conversations.length) {
    await bridgeRequest({
      method: "POST",
      path: "/v1/history/import",
      body: { conversations },
    });
  }
  await chrome.storage.local.set({ [CHAT_HISTORY_MIGRATED_KEY]: true });
}

async function executeInPage(sender, func, args = []) {
  const tabId = sender.tab?.id;
  if (!tabId) throw new Error("No Overleaf tab is associated with this request.");
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [sender.frameId || 0] },
    world: "MAIN",
    func,
    args,
  });
  return result;
}

async function bridgeRequest(request = {}) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.bridgeToken) {
    throw new Error("请先在扩展设置中填写本机桥接 Token。");
  }

  const base = normalizeBridgeUrl(settings.bridgeUrl);
  const pathname = String(request.path || "");
  if (!pathname.startsWith("/v1/") || pathname.includes("..")) {
    throw new Error("Invalid bridge path.");
  }

  const response = await fetch(`${base}${pathname}`, {
    method: request.method || "GET",
    headers: {
      Authorization: `Bearer ${settings.bridgeToken}`,
      "Content-Type": "application/json",
    },
    body:
      request.body === undefined || request.method === "GET"
        ? undefined
        : JSON.stringify(request.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Bridge returned HTTP ${response.status}.`);
  return payload;
}

async function syncOverleafProject(sender, { purpose = "turn" } = {}) {
  const context = overleafProjectRequestContext(sender);
  const key = `${context.origin}|${context.projectId}`;
  const active = ACTIVE_PROJECT_SYNCS.get(key);
  if (active) {
    if (purpose === "pre-sync" || active.purpose === "turn") {
      return active.promise;
    }
    try {
      await active.promise;
    } catch {
      // A speculative pre-sync failure must not prevent a final turn sync retry.
    }
    return syncOverleafProject(sender, { purpose });
  }

  const promise = syncOverleafProjectNow(sender, context, {
    stateHint: PROJECT_SYNC_STATE_CACHE.get(key) || null,
  })
    .then((result) => {
      PROJECT_SYNC_STATE_CACHE.set(
        key,
        projectStateFromSyncResult(result, context),
      );
      return result;
    })
    .catch((error) => {
      PROJECT_SYNC_STATE_CACHE.delete(key);
      throw error;
    })
    .finally(() => {
      if (ACTIVE_PROJECT_SYNCS.get(key)?.promise === promise) {
        ACTIVE_PROJECT_SYNCS.delete(key);
      }
    });
  ACTIVE_PROJECT_SYNCS.set(key, { promise, purpose });
  return promise;
}

function overleafProjectRequestContext(sender) {
  const tabUrl = new URL(String(sender.tab?.url || ""));
  if (
    tabUrl.protocol !== "https:" ||
    !(
      tabUrl.hostname === "overleaf.com" ||
      tabUrl.hostname.endsWith(".overleaf.com")
    )
  ) {
    throw new Error("只能同步当前 overleaf.com 项目。");
  }
  const match = tabUrl.pathname.match(/^\/project\/([^/]+)/i);
  if (!match) throw new Error("无法从当前页面识别 Overleaf 项目。");
  const projectId = decodeURIComponent(match[1]);
  if (!projectId || projectId.length > 200) {
    throw new Error("当前 Overleaf 项目 ID 无效。");
  }
  const projectName = String(sender.tab?.title || "")
    .replace(/\s+[-–—|]\s+Overleaf.*$/i, "")
    .replace(/\s+[-–—|]\s+Online LaTeX Editor.*$/i, "")
    .trim()
    .slice(0, 500);
  return {
    tabUrl,
    origin: tabUrl.origin,
    projectId,
    projectName: projectName || `Overleaf project ${projectId}`,
  };
}

async function syncOverleafProjectNow(
  sender,
  context,
  { stateHint = null } = {},
) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.bridgeToken) {
    throw new Error("请先在扩展设置中填写本机桥接 Token。");
  }
  const base = normalizeBridgeUrl(settings.bridgeUrl);
  const bridgeStateCacheHit = Boolean(stateHint?.exists);
  let state =
    stateHint ||
    (await bridgeProjectJson(base, settings.bridgeToken, context, {
      method: "GET",
      path: `/v1/workspaces/${encodeURIComponent(context.projectId)}/state`,
    }));
  let bootstrapResult = null;
  if (!state?.exists) {
    bootstrapResult = await bootstrapOverleafProject(
      context,
      base,
      settings.bridgeToken,
    );
    state = {
      exists: true,
      project: bootstrapResult,
      fileCount: bootstrapResult.fileCount,
    };
  }
  const historyVersion = Number(state?.project?.historyVersion);
  if (!Number.isSafeInteger(historyVersion) || historyVersion < 0) {
    throw new Error(
      "本地项目镜像缺少有效的 Overleaf 历史版本，无法执行增量同步。",
    );
  }

  const page = await executeInPage(sender, captureOverleafSyncMetadata);
  const csrfToken =
    typeof page?.csrfToken === "string" ? page.csrfToken.trim() : "";
  if (!csrfToken) {
    throw new Error("无法读取 Overleaf 会话校验信息，请刷新项目页面后重试。");
  }

  let currentVersion = historyVersion;
  let lastResult =
    bootstrapResult || syncResultFromProjectState(state, context);
  let changedCount = Number(bootstrapResult?.changedCount) || 0;
  let deletedCount = Number(bootstrapResult?.deletedCount) || 0;
  let downloadedBlobCount = 0;
  let historyChangeCount = 0;

  for (let round = 0; round < MAX_INCREMENTAL_SYNC_ROUNDS; round += 1) {
    await flushOverleafHistory(context, csrfToken);
    const latestVersion = await fetchLatestOverleafVersion(
      context,
      currentVersion,
    );
    if (latestVersion === currentVersion) {
      const validatedAt = Date.now();
      return {
        ...lastResult,
        syncedAt: validatedAt,
        validatedAt,
        incremental: !bootstrapResult,
        bootstrapped: Boolean(bootstrapResult),
        changedCount,
        deletedCount,
        downloadedBlobCount,
        historyChangeCount,
        fastPath: !bootstrapResult && historyChangeCount === 0,
        probeOnly: !bootstrapResult && historyChangeCount === 0,
        bridgeStateCacheHit,
        validationRounds: round + 1,
      };
    }
    if (latestVersion < currentVersion) {
      throw new Error(
        `Overleaf 项目版本校验失败：远端 ${latestVersion}，本地 ${currentVersion}。`,
      );
    }

    const delta = await fetchOverleafChanges(context, currentVersion);
    if (!delta.changes.length || delta.toVersion <= currentVersion) {
      throw new Error(
        `Overleaf 已报告版本 ${latestVersion}，但没有返回版本 ${currentVersion} 之后的增量记录。`,
      );
    }
    historyChangeCount += delta.changes.length;
    const hashes = collectOverleafBlobHashes(delta.changes);
    await uploadOverleafBlobs(
      context,
      hashes,
      base,
      settings.bridgeToken,
    );
    downloadedBlobCount += hashes.length;

    lastResult = await bridgeProjectJson(
      base,
      settings.bridgeToken,
      context,
      {
        method: "POST",
        path: `/v1/workspaces/${encodeURIComponent(
          context.projectId,
        )}/incremental-sync`,
        body: {
          fromVersion: currentVersion,
          toVersion: delta.toVersion,
          changes: delta.changes,
          projectName:
            state?.project?.projectName || context.projectName,
        },
      },
    );
    changedCount += Number(lastResult.changedCount) || 0;
    deletedCount += Number(lastResult.deletedCount) || 0;
    currentVersion = delta.toVersion;
  }

  throw new Error(
    "Overleaf 项目在同步期间持续发生变化，未能取得稳定版本，请稍后再次发送。",
  );
}

function projectStateFromSyncResult(result, context) {
  return {
    exists: true,
    workspaceId:
      result.workspaceId || `${context.origin}|${context.projectId}`,
    project: {
      projectId: result.projectId || context.projectId,
      projectName: result.projectName || context.projectName,
      origin: context.origin,
      historyVersion: result.historyVersion,
      syncedAt: result.syncedAt,
      fileCount: Number(result.fileCount) || 0,
      totalBytes: Number(result.totalBytes) || 0,
    },
    fileCount: Number(result.fileCount) || 0,
  };
}

function syncResultFromProjectState(state, context) {
  const project = state?.project || {};
  return {
    synced: true,
    incremental: true,
    workspaceId:
      state?.workspaceId || `${context.origin}|${context.projectId}`,
    projectId: project.projectId || context.projectId,
    projectName: project.projectName || context.projectName,
    historyVersion: project.historyVersion,
    syncedAt: project.syncedAt,
    fileCount: Number(project.fileCount ?? state?.fileCount) || 0,
    totalBytes: Number(project.totalBytes) || 0,
    changedCount: 0,
    deletedCount: 0,
  };
}

async function bootstrapOverleafProject(context, base, bridgeToken) {
  const downloadUrl = new URL(
    `/project/${encodeURIComponent(context.projectId)}/download/zip`,
    context.origin,
  );
  const source = await fetch(downloadUrl, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    redirect: "follow",
    headers: { Accept: "application/zip, application/octet-stream" },
  });
  if (!source.ok) {
    throw new Error(`无法下载 Overleaf 项目（HTTP ${source.status}）。`);
  }
  const archive = await source.arrayBuffer();
  const signature = new Uint8Array(archive, 0, Math.min(4, archive.byteLength));
  if (
    archive.byteLength < 4 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b
  ) {
    throw new Error("Overleaf 返回的不是项目 ZIP，请确认登录状态和项目权限。");
  }

  const projectName =
    projectNameFromDisposition(source.headers.get("Content-Disposition")) ||
    context.projectName;
  const historyVersion = source.headers.get("X-History-Version") || "";
  const response = await fetch(
    `${base}/v1/workspaces/${encodeURIComponent(context.projectId)}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        "Content-Type": "application/zip",
        "X-Overleaf-Origin": encodeURIComponent(context.origin),
        "X-Overleaf-Project-Name": encodeURIComponent(projectName),
        "X-Overleaf-History-Version": encodeURIComponent(historyVersion),
      },
      body: archive,
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Bridge returned HTTP ${response.status}.`);
  }
  return {
    ...payload,
    incremental: false,
    downloadedBlobCount: 0,
    validationRounds: 0,
  };
}

async function bridgeProjectJson(base, bridgeToken, context, request) {
  const response = await fetch(`${base}${request.path}`, {
    method: request.method || "GET",
    headers: {
      Authorization: `Bearer ${bridgeToken}`,
      "Content-Type": "application/json",
      "X-Overleaf-Origin": encodeURIComponent(context.origin),
    },
    body:
      request.body === undefined || request.method === "GET"
        ? undefined
        : JSON.stringify(request.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Bridge returned HTTP ${response.status}.`);
  }
  return payload;
}

async function flushOverleafHistory(context, csrfToken) {
  const url = new URL(
    `/project/${encodeURIComponent(context.projectId)}/flush`,
    context.origin,
  );
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Csrf-Token": csrfToken,
    },
  });
  if (!response.ok) {
    throw new Error(`无法刷新 Overleaf 项目历史（HTTP ${response.status}）。`);
  }
}

async function fetchOverleafChanges(context, fromVersion) {
  const changes = [];
  let cursor = fromVersion;

  for (let page = 0; page < MAX_INCREMENTAL_CHANGE_PAGES; page += 1) {
    const url = new URL(
      `/project/${encodeURIComponent(
        context.projectId,
      )}/changes?since=${encodeURIComponent(cursor)}&paginated=true`,
      context.origin,
    );
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`无法读取 Overleaf 增量记录（HTTP ${response.status}）。`);
    }
    const payload = await response.json();
    const pageChanges = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.changes)
        ? payload.changes
        : null;
    if (!pageChanges) {
      throw new Error("Overleaf 返回了无法识别的项目增量记录。");
    }
    changes.push(...pageChanges);
    cursor += pageChanges.length;
    const hasMore = !Array.isArray(payload) && payload?.hasMore === true;
    if (!hasMore) {
      return { changes, toVersion: cursor };
    }
    if (!pageChanges.length) {
      throw new Error("Overleaf 增量记录分页未前进，已停止同步。");
    }
  }

  throw new Error("Overleaf 增量记录分页过多，已停止同步。");
}

async function fetchLatestOverleafVersion(context, fallbackVersion) {
  const url = new URL(
    `/project/${encodeURIComponent(context.projectId)}/updates`,
    context.origin,
  );
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`无法校验 Overleaf 项目版本（HTTP ${response.status}）。`);
  }
  const payload = await response.json();
  const versions = Array.isArray(payload?.updates)
    ? payload.updates
        .map((update) => Number(update?.toV))
        .filter((value) => Number.isSafeInteger(value) && value >= 0)
    : [];
  return versions.length ? Math.max(...versions) : fallbackVersion;
}

function collectOverleafBlobHashes(changes) {
  const hashes = new Set();
  for (const change of changes) {
    for (const operation of Array.isArray(change?.operations)
      ? change.operations
      : []) {
      const hash = operation?.file?.hash;
      if (typeof hash === "string" && /^[a-f0-9]{40}$/i.test(hash)) {
        hashes.add(hash.toLowerCase());
      }
    }
  }
  return [...hashes];
}

async function uploadOverleafBlobs(
  context,
  hashes,
  base,
  bridgeToken,
) {
  await mapWithConcurrency(hashes, BLOB_UPLOAD_CONCURRENCY, async (hash) => {
    const sourceUrl = new URL(
      `/project/${encodeURIComponent(context.projectId)}/blob/${hash}`,
      context.origin,
    );
    const source = await fetch(sourceUrl, {
      method: "GET",
      credentials: "include",
      cache: "default",
      headers: { Accept: "application/octet-stream" },
    });
    if (!source.ok) {
      throw new Error(`无法下载 Overleaf 变化文件（HTTP ${source.status}）。`);
    }
    const content = await source.arrayBuffer();
    const response = await fetch(
      `${base}/v1/workspaces/${encodeURIComponent(
        context.projectId,
      )}/blobs/${hash}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${bridgeToken}`,
          "Content-Type": "application/octet-stream",
          "X-Overleaf-Origin": encodeURIComponent(context.origin),
        },
        body: content,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload.error || `Bridge returned HTTP ${response.status}.`,
      );
    }
  });
}

async function mapWithConcurrency(values, concurrency, task) {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (index < values.length) {
        const current = values[index];
        index += 1;
        await task(current);
      }
    },
  );
  await Promise.all(workers);
}

function captureOverleafSyncMetadata() {
  const csrfToken =
    document.querySelector('meta[name="ol-csrfToken"]')?.getAttribute("content") ||
    document.querySelector('meta[name="ol-csrf-token"]')?.getAttribute("content") ||
    "";
  return { csrfToken };
}

function projectNameFromDisposition(value) {
  const text = String(value || "");
  const encoded = text.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = text.match(/filename="([^"]+)"/i)?.[1];
  const plain = text.match(/filename=([^;]+)/i)?.[1];
  let name = encoded || quoted || plain || "";
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the server-provided ASCII fallback.
  }
  return name.trim().replace(/\.zip$/i, "").slice(0, 500);
}

function normalizeBridgeUrl(value) {
  const url = new URL(value || DEFAULT_SETTINGS.bridgeUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("桥接地址必须是本机 http://127.0.0.1 或 http://localhost。");
  }
  return url.origin;
}

function captureOverleafSelection() {
  const browserSelection = window.getSelection();
  const range =
    browserSelection && browserSelection.rangeCount > 0
      ? browserSelection.getRangeAt(0)
      : null;
  const anchorElement =
    range?.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range?.commonAncestorContainer.parentElement;
  const editors = Array.from(document.querySelectorAll(".cm-editor"));
  const editor =
    anchorElement?.closest?.(".cm-editor") ||
    document.activeElement?.closest?.(".cm-editor") ||
    document.querySelector(".cm-editor.cm-focused") ||
    editors.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    });
  if (!editor) return { available: false, reason: "not-overleaf-source-editor" };

  const rect =
    range && !browserSelection.isCollapsed && anchorElement?.closest?.(".cm-editor") === editor
      ? range.getBoundingClientRect()
      : editor.getBoundingClientRect();
  const view = findCodeMirrorView(editor);
  const editorIndex = editors.indexOf(editor);
  const filePath = detectActiveFilePath();
  const fileName = filePath?.split("/").at(-1) || null;

  if (!view) {
    const fallbackText =
      browserSelection && !browserSelection.isCollapsed
        ? browserSelection.toString()
        : "";
    return {
      available: Boolean(fallbackText),
      viewAvailable: false,
      text: fallbackText,
      rect: serializeRect(rect),
      editorIndex,
      filePath,
      fileName,
      lineStart: null,
      lineEnd: null,
      reason: "codemirror-view-unavailable",
    };
  }

  let from = view.state.selection.main.from;
  let to = view.state.selection.main.to;
  if (
    from === to &&
    range &&
    !browserSelection.isCollapsed &&
    typeof view.posAtDOM === "function"
  ) {
    try {
      from = view.posAtDOM(range.startContainer, range.startOffset);
      to = view.posAtDOM(range.endContainer, range.endOffset);
    } catch {
      return { available: false, reason: "selection-position-unavailable" };
    }
  }
  if (from > to) [from, to] = [to, from];

  const documentLength = view.state.doc.length;
  const text = view.state.doc.sliceString(from, to);
  const contextStart = Math.max(0, from - 1200);
  const contextEnd = Math.min(documentLength, to + 1200);
  const anchorStart = Math.max(0, from - 80);
  const anchorEnd = Math.min(documentLength, to + 80);
  const lineStart = lineNumberAt(view.state.doc, from);
  const lineEnd = lineNumberAt(view.state.doc, to > from ? to - 1 : to);
  const lineText = lineTextAt(view.state.doc, from);

  return {
    available: true,
    viewAvailable: true,
    text,
    from,
    to,
    documentLength,
    contextBefore: view.state.doc.sliceString(contextStart, from),
    contextAfter: view.state.doc.sliceString(to, contextEnd),
    anchorBefore: view.state.doc.sliceString(anchorStart, from),
    anchorAfter: view.state.doc.sliceString(to, anchorEnd),
    editorIndex,
    filePath,
    fileName,
    lineStart,
    lineEnd,
    lineText,
    emptySelection: from === to,
    rect: serializeRect(rect),
  };

  function lineNumberAt(doc, position) {
    const safePosition = Math.max(0, Math.min(Number(position) || 0, doc.length));
    if (typeof doc.lineAt === "function") {
      return doc.lineAt(safePosition).number;
    }
    return doc.sliceString(0, safePosition).split("\n").length;
  }

  function lineTextAt(doc, position) {
    const safePosition = Math.max(0, Math.min(Number(position) || 0, doc.length));
    if (typeof doc.lineAt === "function") {
      return String(doc.lineAt(safePosition).text || "").slice(0, 20_000);
    }
    const before = doc.sliceString(0, safePosition);
    const after = doc.sliceString(safePosition, doc.length);
    return `${before.split("\n").at(-1) || ""}${
      after.split("\n")[0] || ""
    }`.slice(0, 20_000);
  }

  function detectActiveFilePath() {
    const selectors = [
      '[data-testid="editor-tab"][aria-selected="true"]',
      '[data-testid="file-tree"] [aria-selected="true"]',
      '.file-tree [aria-selected="true"]',
      ".file-tree .selected",
      ".file-tree .active",
      '[role="treeitem"][aria-selected="true"]',
      ".editor-tabs .active",
      ".nav-tabs .active",
    ];
    const supportedExtension =
      /\.(?:tex|bib|sty|cls|bst|md|txt|csv|json|yaml|yml)$/i;
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const namedChild = element.querySelector(
          '[data-testid*="file-name"], .entity-name, .file-name, .item-name, .name',
        );
        const values = [
          element.getAttribute("data-path"),
          element.getAttribute("title"),
          element.getAttribute("aria-label"),
          namedChild?.textContent,
          element.textContent,
        ];
        for (const value of values) {
          const normalized = normalizeCandidate(value);
          if (normalized) return normalized;
        }
      }
    }
    return null;

    function normalizeCandidate(value) {
      const text = String(value || "").trim().replaceAll("\\", "/");
      if (!text) return null;
      const exact = text.replace(/^\/+/, "").replace(/\/+/g, "/");
      if (
        supportedExtension.test(exact) &&
        !exact.includes("\n") &&
        !exact.includes("\r")
      ) {
        return exact.slice(0, 1_000);
      }
      const match = text.match(
        /((?:[^/\\\n\r:]+\/)*[^/\\\n\r:]+\.(?:tex|bib|sty|cls|bst|md|txt|csv|json|yaml|yml))/i,
      );
      return match ? match[1].trim().replace(/^\/+/, "").slice(0, 1_000) : null;
    }
  }

  function findCodeMirrorView(root) {
    const direct = [root.cmView, root.querySelector(".cm-content")?.cmView];
    const queue = direct.filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      if (
        candidate.state?.doc &&
        candidate.state?.selection &&
        typeof candidate.dispatch === "function"
      ) {
        return candidate;
      }
      for (const key of ["view", "rootView", "parent", "editorView"]) {
        const nested = candidate[key];
        if (nested && typeof nested === "object") queue.push(nested);
      }
    }
    return null;
  }

  function serializeRect(value) {
    return {
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      left: value.left,
      width: value.width,
      height: value.height,
    };
  }
}

function captureOverleafCurrentFile(preferredEditorIndex) {
  const editors = Array.from(document.querySelectorAll(".cm-editor"));
  const preferred = Number.isInteger(preferredEditorIndex)
    ? editors[preferredEditorIndex]
    : null;
  const selection = window.getSelection();
  const range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const anchorElement =
    range?.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range?.commonAncestorContainer.parentElement;
  const candidates = [
    preferred,
    anchorElement?.closest?.(".cm-editor"),
    document.activeElement?.closest?.(".cm-editor"),
    document.querySelector(".cm-editor.cm-focused"),
    ...editors,
  ].filter(Boolean);

  let editor = null;
  let view = null;
  for (const candidate of candidates) {
    const candidateView = findCodeMirrorView(candidate);
    const rect = candidate.getBoundingClientRect();
    const style = window.getComputedStyle(candidate);
    if (
      candidateView &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    ) {
      editor = candidate;
      view = candidateView;
      break;
    }
  }
  if (!editor || !view) {
    return { available: false, reason: "current-file-unavailable" };
  }

  const content = view.state.doc.sliceString(0, view.state.doc.length);
  const editorIndex = editors.indexOf(editor);
  const relativePath = detectActiveFilePath();
  return {
    available: true,
    name: relativePath?.split("/").at(-1) || `当前文件 ${editorIndex + 1}`,
    relativePath,
    content,
    length: content.length,
    editorIndex,
    capturedAt: Date.now(),
  };

  function findCodeMirrorView(root) {
    const direct = [root.cmView, root.querySelector(".cm-content")?.cmView];
    const queue = direct.filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      if (
        candidate.state?.doc &&
        candidate.state?.selection &&
        typeof candidate.dispatch === "function"
      ) {
        return candidate;
      }
      for (const key of ["view", "rootView", "parent", "editorView"]) {
        const nested = candidate[key];
        if (nested && typeof nested === "object") queue.push(nested);
      }
    }
    return null;
  }

  function detectActiveFilePath() {
    const selectors = [
      '[data-testid="editor-tab"][aria-selected="true"]',
      '[data-testid="file-tree"] [aria-selected="true"]',
      '.file-tree [aria-selected="true"]',
      '.file-tree .selected',
      '.file-tree .active',
      '[role="treeitem"][aria-selected="true"]',
      '.editor-tabs .active',
      '.nav-tabs .active',
    ];
    const supportedExtension =
      /\.(?:tex|bib|sty|cls|bst|md|txt|csv|json|yaml|yml)$/i;
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const namedChild = element.querySelector(
          '[data-testid*="file-name"], .entity-name, .file-name, .item-name, .name',
        );
        const values = [
          element.getAttribute("data-path"),
          element.getAttribute("title"),
          element.getAttribute("aria-label"),
          namedChild?.textContent,
          element.textContent,
        ];
        for (const value of values) {
          const normalized = normalizeCandidate(value);
          if (normalized) return normalized;
        }
      }
    }
    return null;

    function normalizeCandidate(value) {
      const text = String(value || "").trim().replaceAll("\\", "/");
      if (!text) return null;
      const exact = text.replace(/^\/+/, "").replace(/\/+/g, "/");
      if (
        supportedExtension.test(exact) &&
        !exact.includes("\n") &&
        !exact.includes("\r")
      ) {
        return exact.slice(0, 1_000);
      }
      const match = text.match(
        /((?:[^/\\\n\r:]+\/)*[^/\\\n\r:]+\.(?:tex|bib|sty|cls|bst|md|txt|csv|json|yaml|yml))/i,
      );
      return match ? match[1].trim().replace(/^\/+/, "").slice(0, 1_000) : null;
    }
  }
}

function applyOverleafReplacement(snapshot, replacement) {
  if (!snapshot?.viewAvailable) {
    return { applied: false, reason: "writeback-unavailable" };
  }
  if (typeof replacement !== "string") {
    return { applied: false, reason: "invalid-replacement" };
  }

  const editors = Array.from(document.querySelectorAll(".cm-editor"));
  const preferred = editors[snapshot.editorIndex];
  const candidates = [preferred, ...editors.filter((editor) => editor !== preferred)].filter(Boolean);

  for (const editor of candidates) {
    const view = findCodeMirrorView(editor);
    if (!view || snapshot.to > view.state.doc.length) continue;
    const current = view.state.doc.sliceString(snapshot.from, snapshot.to);
    if (current !== snapshot.text) continue;

    const beforeStart = Math.max(0, snapshot.from - snapshot.anchorBefore.length);
    const afterEnd = Math.min(
      view.state.doc.length,
      snapshot.to + snapshot.anchorAfter.length,
    );
    const before = view.state.doc.sliceString(beforeStart, snapshot.from);
    const after = view.state.doc.sliceString(snapshot.to, afterEnd);
    if (before !== snapshot.anchorBefore || after !== snapshot.anchorAfter) {
      return { applied: false, reason: "selection-stale" };
    }

    view.dispatch({
      changes: {
        from: snapshot.from,
        to: snapshot.to,
        insert: replacement,
      },
      selection: { anchor: snapshot.from + replacement.length },
      scrollIntoView: true,
    });
    view.focus();
    return {
      applied: true,
      from: snapshot.from,
      to: snapshot.from + replacement.length,
    };
  }

  return { applied: false, reason: "selection-stale" };

  function findCodeMirrorView(root) {
    const direct = [root.cmView, root.querySelector(".cm-content")?.cmView];
    const queue = direct.filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      if (
        candidate.state?.doc &&
        candidate.state?.selection &&
        typeof candidate.dispatch === "function"
      ) {
        return candidate;
      }
      for (const key of ["view", "rootView", "parent", "editorView"]) {
        const nested = candidate[key];
        if (nested && typeof nested === "object") queue.push(nested);
      }
    }
    return null;
  }
}
