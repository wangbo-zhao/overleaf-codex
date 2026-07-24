(() => {
  if (window.__overleafCodexLoaded) return;
  window.__overleafCodexLoaded = true;

  const PROJECT_PRE_SYNC_IDLE_MS = 1_500;
  const PROJECT_PRE_SYNC_VISIBLE_DELAY_MS = 250;
  const PROJECT_FINAL_SYNC_MAX_ATTEMPTS = 3;
  let projectPreSyncTimer = null;
  let projectPreSyncDirty = false;
  let projectPreSyncRunning = false;
  let projectEditGeneration = 0;
  let editorCompositionActive = false;

  const state = {
    snapshot: null,
    selectionReferences: [],
    activeTurnSelectionReferences: [],
    threadId: null,
    activeJobId: null,
    eventSequence: 0,
    plugins: [],
    pluginsLoaded: false,
    models: [],
    modelsLoaded: false,
    modelsLoading: false,
    selectedModelId: null,
    selectedEffort: null,
    mentionMatches: [],
    mentionIndex: 0,
    dialogSize: null,
    dialogPosition: null,
    userPositioned: false,
    maximized: false,
    restoreBounds: null,
    candidateStates: [],
    busy: false,
    history: [],
    historyOpen: false,
    settingsOpen: false,
    settingsPreviousSubtitle: "新对话",
    activeConversationId: null,
    conversationMessages: [],
    resumeHistory: [],
    attachedFiles: [],
    pendingMessages: [],
    projectContext: null,
    currentProject: null,
    historyProjectMismatch: false,
    historySaveChain: Promise.resolve(),
  };

  const EFFORT_LABELS = {
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "超高",
    max: "最高",
    ultra: "Ultra",
  };

  const ICONS = {
    history: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>`,
    back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`,
    newChat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>`,
    maximize: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`,
    restore: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="4" width="13" height="13" rx="2"/><path d="M17 17v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
    context: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h5"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`,
    send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 18V6M7 11l5-5 5 5"/></svg>`,
    stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>`,
  };

  const host = document.createElement("div");
  host.id = "overleaf-codex-root";
  host.style.display = "none";
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const katexStylesheet = chrome.runtime.getURL("vendor/katex/katex.min.css");
  shadow.innerHTML = `<link rel="stylesheet" href="${katexStylesheet}">${styles()}
    <section class="dialog" role="dialog" aria-label="Overleaf Codex">
      <header class="topbar">
        <div class="title-area">
          <button class="icon-button history-button" type="button" title="历史对话" aria-label="历史对话">${ICONS.history}</button>
          <button class="icon-button new-chat-button" type="button" title="新对话" aria-label="新对话">${ICONS.newChat}</button>
          <span class="title-divider"></span>
          <div class="window-title">
            <strong>Overleaf Codex</strong>
            <span>新对话</span>
          </div>
        </div>
        <div class="top-actions">
          <button class="icon-button settings-button" type="button" title="设置" aria-label="设置">${ICONS.settings}</button>
          <button class="icon-button maximize-button" type="button" title="最大化" aria-label="最大化">${ICONS.maximize}</button>
          <button class="icon-button close-button" type="button" title="关闭" aria-label="关闭">${ICONS.close}</button>
        </div>
      </header>

      <div class="dialog-content">
        <aside class="history-sidebar" aria-label="历史对话" aria-hidden="true">
          <div class="history-header">
            <button class="icon-button history-close" type="button" title="返回对话" aria-label="返回对话">${ICONS.back}</button>
            <strong>历史对话</strong>
          </div>
          <button class="history-new-chat" type="button">
            <span>${ICONS.newChat}</span>
            <span>新对话</span>
          </button>
          <div class="history-list"></div>
          <div class="history-empty" hidden>还没有历史对话</div>
        </aside>
        <button class="history-scrim" type="button" aria-label="收起历史对话"></button>

        <main class="chat-pane">
          <div class="messages" aria-live="polite"></div>

          <div class="composer">
            <div class="pending-messages" aria-label="待发送消息" hidden></div>
            <div class="composer-box">
              <div class="selection-references" aria-label="选区引用" hidden></div>
              <div class="attached-files" aria-label="已添加文件" hidden></div>
              <div class="composer-input">
                <textarea rows="2" placeholder="向 Codex 发送消息"></textarea>
                <div class="mention-menu" hidden>
                  <div class="mention-menu-head">
                    <strong>Codex 插件</strong>
                    <button class="refresh-plugins text-button" type="button">刷新</button>
                  </div>
                  <div class="mention-list"></div>
                </div>
              </div>
              <div class="composer-footer">
                <div class="composer-left">
                  <button class="composer-icon attachment-trigger" type="button" title="添加上下文" aria-label="添加上下文" aria-expanded="false">${ICONS.plus}</button>
                  <span class="composer-hint">添加文件，输入 @ 调用插件</span>
                </div>
                <div class="composer-actions">
                  <div class="model-control">
                    <button class="model-button" type="button" title="选择模型和推理强度">
                      <span class="model-button-label">读取模型…</span><span aria-hidden="true">⌄</span>
                    </button>
                  </div>
                  <button class="send-button" type="button" title="发送" aria-label="发送">${ICONS.send}</button>
                </div>
              </div>
            </div>
            <div class="attachment-menu" hidden>
              <button class="attachment-option add-selection-reference" type="button" hidden>
                <span class="attachment-option-icon">${ICONS.context}</span>
                <span>
                  <strong>添加当前选区引用</strong>
                  <small>也可按 ⌘/Ctrl + Shift + I，支持添加多个</small>
                </span>
              </button>
              <button class="attachment-option add-current-file" type="button">
                <span class="attachment-option-icon">${ICONS.context}</span>
                <span>
                  <strong>强调当前文件</strong>
                  <small>项目镜像已自动同步；将此文件设为重点上下文</small>
                </span>
              </button>
            </div>
            <div class="model-panel" hidden>
              <div class="model-panel-column">
                <div class="picker-heading">
                  <strong>模型</strong>
                  <button class="refresh-models text-button" type="button">刷新</button>
                </div>
                <div class="model-list"></div>
              </div>
              <div class="model-panel-column effort-column">
                <div class="picker-heading"><strong>推理强度</strong></div>
                <div class="effort-list"></div>
              </div>
            </div>
          </div>
        </main>
      </div>
      <section class="settings-pane" aria-label="Overleaf Codex 设置" hidden>
        <div class="settings-scroll">
          <div class="settings-heading">
            <button class="icon-button settings-back" type="button" title="返回对话" aria-label="返回对话">${ICONS.back}</button>
            <div>
              <h2>设置</h2>
              <p>连接本机 Codex，并管理历史和项目镜像的位置。</p>
            </div>
          </div>

          <section class="settings-card">
            <div class="settings-card-heading">
              <div>
                <h3>本机桥接</h3>
                <p>桥接只监听本机地址。</p>
              </div>
              <span class="local-badge">LOCAL</span>
            </div>
            <label class="settings-field">
              <span>桥接地址</span>
              <input class="settings-bridge-url" type="url" spellcheck="false" />
              <small>仅允许 127.0.0.1 或 localhost。</small>
            </label>
            <label class="settings-field">
              <span>桥接 Token</span>
              <div class="settings-input-row">
                <input class="settings-bridge-token" type="password" autocomplete="off" spellcheck="false" />
                <button class="settings-reveal secondary-button" type="button">显示</button>
              </div>
              <small>运行 npm run show-token 获取。</small>
            </label>
          </section>

          <section class="settings-card">
            <div class="settings-card-heading">
              <div>
                <h3>本地数据</h3>
                <p>留空即可使用默认目录。</p>
              </div>
            </div>
            <label class="settings-field">
              <span>历史会话目录</span>
              <div class="settings-input-row">
                <input class="settings-history-directory" type="text" autocomplete="off" spellcheck="false" />
                <button class="settings-reset-history secondary-button" type="button">默认</button>
              </div>
              <small class="settings-history-hint">正在读取目录…</small>
            </label>
            <label class="settings-field">
              <span>项目工作区目录</span>
              <div class="settings-input-row">
                <input class="settings-workspace-directory" type="text" autocomplete="off" spellcheck="false" />
                <button class="settings-reset-workspace secondary-button" type="button">默认</button>
              </div>
              <small class="settings-workspace-hint">正在读取目录…</small>
            </label>
            <p class="settings-note">更改工作区时会复制已有项目镜像；原目录会保留。编辑暂停后会静默预同步，发送消息前仍会校验最新 Overleaf 版本。</p>
          </section>

          <section class="settings-card">
            <div class="settings-card-heading">
              <div>
                <h3>快捷键</h3>
                <p>快捷键由 Chrome 管理，可按个人习惯修改。</p>
              </div>
            </div>
            <div class="shortcut-list">
              <div class="shortcut-row">
                <span>打开 Overleaf Codex</span>
                <kbd class="shortcut-open">正在读取…</kbd>
              </div>
              <div class="shortcut-row">
                <span>添加选区引用</span>
                <kbd class="shortcut-reference">正在读取…</kbd>
              </div>
            </div>
            <button class="settings-shortcuts secondary-button" type="button">在 Chrome 中自定义快捷键</button>
          </section>

          <p class="settings-status" role="status" aria-live="polite"></p>
          <div class="settings-actions">
            <button class="settings-test secondary-button" type="button">测试连接</button>
            <button class="settings-save primary-button" type="button">保存设置</button>
          </div>
        </div>
      </section>
      <div class="resize-handle resize-n" data-direction="n"></div>
      <div class="resize-handle resize-ne" data-direction="ne"></div>
      <div class="resize-handle resize-e" data-direction="e"></div>
      <div class="resize-handle resize-se" data-direction="se" title="拖动调整大小"></div>
      <div class="resize-handle resize-s" data-direction="s"></div>
      <div class="resize-handle resize-sw" data-direction="sw"></div>
      <div class="resize-handle resize-w" data-direction="w"></div>
      <div class="resize-handle resize-nw" data-direction="nw"></div>
    </section>`;

  const ui = {
    dialog: shadow.querySelector(".dialog"),
    selectionReferences: shadow.querySelector(".selection-references"),
    messages: shadow.querySelector(".messages"),
    textarea: shadow.querySelector("textarea"),
    send: shadow.querySelector(".send-button"),
    mentionMenu: shadow.querySelector(".mention-menu"),
    mentionList: shadow.querySelector(".mention-list"),
    modelButton: shadow.querySelector(".model-button"),
    modelButtonLabel: shadow.querySelector(".model-button-label"),
    modelPanel: shadow.querySelector(".model-panel"),
    modelList: shadow.querySelector(".model-list"),
    effortList: shadow.querySelector(".effort-list"),
    resizeHandles: shadow.querySelectorAll(".resize-handle"),
    topbar: shadow.querySelector(".topbar"),
    maximize: shadow.querySelector(".maximize-button"),
    historyButton: shadow.querySelector(".history-button"),
    newChatButton: shadow.querySelector(".new-chat-button"),
    historyNewChat: shadow.querySelector(".history-new-chat"),
    historySidebar: shadow.querySelector(".history-sidebar"),
    historyList: shadow.querySelector(".history-list"),
    historyEmpty: shadow.querySelector(".history-empty"),
    attachedFiles: shadow.querySelector(".attached-files"),
    pendingMessages: shadow.querySelector(".pending-messages"),
    attachmentTrigger: shadow.querySelector(".attachment-trigger"),
    attachmentMenu: shadow.querySelector(".attachment-menu"),
    addSelectionReference: shadow.querySelector(".add-selection-reference"),
    addCurrentFile: shadow.querySelector(".add-current-file"),
    settingsPane: shadow.querySelector(".settings-pane"),
    settingsButton: shadow.querySelector(".settings-button"),
    settingsBridgeUrl: shadow.querySelector(".settings-bridge-url"),
    settingsBridgeToken: shadow.querySelector(".settings-bridge-token"),
    settingsHistoryDirectory: shadow.querySelector(".settings-history-directory"),
    settingsHistoryHint: shadow.querySelector(".settings-history-hint"),
    settingsWorkspaceDirectory: shadow.querySelector(".settings-workspace-directory"),
    settingsWorkspaceHint: shadow.querySelector(".settings-workspace-hint"),
    shortcutOpen: shadow.querySelector(".shortcut-open"),
    shortcutReference: shadow.querySelector(".shortcut-reference"),
    settingsShortcuts: shadow.querySelector(".settings-shortcuts"),
    settingsStatus: shadow.querySelector(".settings-status"),
    settingsSave: shadow.querySelector(".settings-save"),
    settingsTest: shadow.querySelector(".settings-test"),
  };

  document.addEventListener("keydown", onDocumentKeydown, true);
  document.addEventListener("input", onOverleafEditorInput, true);
  document.addEventListener("compositionstart", onEditorCompositionStart, true);
  document.addEventListener("compositionend", onEditorCompositionEnd, true);
  document.addEventListener("visibilitychange", onPageVisibilityChange);
  window.addEventListener("pagehide", cancelProjectPreSync);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "open_from_shortcut") openCodexDialog(true);
    if (message?.type === "add_reference_from_shortcut") {
      addSelectionReferenceFromEditor(true);
    }
  });

  shadow.querySelector(".close-button").addEventListener("click", closeDialog);
  shadow.querySelector(".new-chat-button").addEventListener("click", beginNewChat);
  shadow.querySelector(".history-new-chat").addEventListener("click", beginNewChat);
  shadow.querySelector(".history-close").addEventListener("click", () =>
    setHistoryOpen(false),
  );
  shadow.querySelector(".history-scrim").addEventListener("click", () =>
    setHistoryOpen(false),
  );
  ui.historyButton.addEventListener("click", () => {
    if (state.settingsOpen) closeInlineSettings();
    setHistoryOpen(!state.historyOpen);
  });
  ui.settingsButton.addEventListener("click", () => {
    if (state.settingsOpen) closeInlineSettings();
    else openInlineSettings();
  });
  shadow.querySelector(".settings-back").addEventListener("click", closeInlineSettings);
  shadow.querySelector(".settings-reveal").addEventListener("click", (event) => {
    const visible = ui.settingsBridgeToken.type === "text";
    ui.settingsBridgeToken.type = visible ? "password" : "text";
    event.currentTarget.textContent = visible ? "显示" : "隐藏";
  });
  shadow.querySelector(".settings-reset-history").addEventListener("click", () => {
    ui.settingsHistoryDirectory.value = "";
    ui.settingsHistoryDirectory.focus();
  });
  shadow.querySelector(".settings-reset-workspace").addEventListener("click", () => {
    ui.settingsWorkspaceDirectory.value = "";
    ui.settingsWorkspaceDirectory.focus();
  });
  ui.settingsSave.addEventListener("click", () => saveInlineSettings(false));
  ui.settingsTest.addEventListener("click", () => saveInlineSettings(true));
  ui.settingsShortcuts.addEventListener("click", openShortcutSettings);
  shadow.querySelector(".refresh-plugins").addEventListener("click", () => loadPlugins(true));
  shadow.querySelector(".refresh-models").addEventListener("click", () => loadModels(true));
  ui.modelButton.addEventListener("click", toggleModelPanel);
  ui.maximize.addEventListener("click", toggleMaximize);
  ui.attachmentTrigger.addEventListener("click", toggleAttachmentMenu);
  ui.addSelectionReference.addEventListener("click", () =>
    addSelectionReferenceFromEditor(true),
  );
  ui.addCurrentFile.addEventListener("click", addCurrentFile);
  ui.send.addEventListener("click", () => {
    if (state.busy && ui.textarea.value.trim()) sendCurrentMessage();
    else if (state.busy) interruptActiveTurn();
    else sendCurrentMessage();
  });
  ui.topbar.addEventListener("pointerdown", startDialogDrag);
  ui.topbar.addEventListener("dblclick", (event) => {
    if (!event.target.closest("button")) toggleMaximize();
  });
  ui.textarea.addEventListener("input", () => {
    resizeComposer();
    updateMentionMenu();
    updateSendButton();
  });
  ui.textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !ui.mentionMenu.hidden) {
      event.preventDefault();
      hideMentionMenu();
      return;
    }
    if (!ui.mentionMenu.hidden && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      moveMentionSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (
      event.key === "Enter" &&
      !ui.mentionMenu.hidden &&
      state.mentionMatches[state.mentionIndex]
    ) {
      event.preventDefault();
      insertPluginMention(state.mentionMatches[state.mentionIndex]);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });
  for (const handle of ui.resizeHandles) {
    handle.addEventListener("pointerdown", startDialogResize);
  }
  window.addEventListener("resize", () => {
    if (host.style.display !== "none") positionDialog(state.snapshot?.rect);
  });
  shadow.addEventListener("pointerdown", (event) => {
    if (
      !ui.modelPanel.contains(event.target) &&
      !ui.modelButton.contains(event.target)
    ) {
      ui.modelPanel.hidden = true;
    }
    if (
      !ui.attachmentMenu.contains(event.target) &&
      !ui.attachmentTrigger.contains(event.target)
    ) {
      setAttachmentMenuOpen(false);
    }
  });
  loadHistory().catch(() => {});

  function onDocumentKeydown(event) {
    if (event.key === "Escape" && host.style.display !== "none") {
      if (state.settingsOpen) {
        closeInlineSettings();
        return;
      }
      if (state.historyOpen) {
        setHistoryOpen(false);
        return;
      }
      closeDialog();
    }
  }

  function onOverleafEditorInput(event) {
    if (!isOverleafEditorEvent(event)) return;
    markProjectDirty();
  }

  function onEditorCompositionStart(event) {
    if (!isOverleafEditorEvent(event)) return;
    editorCompositionActive = true;
    if (projectPreSyncTimer !== null) {
      window.clearTimeout(projectPreSyncTimer);
      projectPreSyncTimer = null;
    }
  }

  function onEditorCompositionEnd(event) {
    if (!isOverleafEditorEvent(event)) return;
    editorCompositionActive = false;
    markProjectDirty();
  }

  function onPageVisibilityChange() {
    if (
      !document.hidden &&
      projectPreSyncDirty &&
      !editorCompositionActive
    ) {
      scheduleProjectPreSync(PROJECT_PRE_SYNC_VISIBLE_DELAY_MS);
    }
  }

  function isOverleafEditorEvent(event) {
    const eventPath =
      typeof event.composedPath === "function"
        ? event.composedPath()
        : [event.target];
    const target = eventPath
      .find((item) => item instanceof Element);
    return Boolean(target?.closest?.(".cm-editor"));
  }

  function markProjectDirty() {
    projectEditGeneration += 1;
    projectPreSyncDirty = true;
    if (!document.hidden && !editorCompositionActive) {
      scheduleProjectPreSync(PROJECT_PRE_SYNC_IDLE_MS);
    }
  }

  function scheduleProjectPreSync(delay) {
    if (projectPreSyncTimer !== null) {
      window.clearTimeout(projectPreSyncTimer);
    }
    projectPreSyncTimer = window.setTimeout(runProjectPreSync, delay);
  }

  function cancelProjectPreSync() {
    if (projectPreSyncTimer !== null) {
      window.clearTimeout(projectPreSyncTimer);
      projectPreSyncTimer = null;
    }
  }

  async function runProjectPreSync() {
    projectPreSyncTimer = null;
    if (
      !projectPreSyncDirty ||
      projectPreSyncRunning ||
      editorCompositionActive ||
      document.hidden
    ) {
      return;
    }
    const generation = projectEditGeneration;
    projectPreSyncDirty = false;
    projectPreSyncRunning = true;
    try {
      await extensionMessage({
        type: "pre_sync_overleaf_project",
        generation,
      });
    } catch {
      // Pre-sync is speculative. A normal send or Steer will surface errors.
    } finally {
      projectPreSyncRunning = false;
      if (
        projectPreSyncDirty &&
        !editorCompositionActive &&
        !document.hidden
      ) {
        scheduleProjectPreSync(PROJECT_PRE_SYNC_IDLE_MS);
      }
    }
  }

  async function syncProjectForTurn() {
    cancelProjectPreSync();
    for (
      let attempt = 0;
      attempt < PROJECT_FINAL_SYNC_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const generation = projectEditGeneration;
      try {
        const result = await extensionMessage({
          type: "sync_overleaf_project",
          generation,
        });
        if (projectEditGeneration !== generation) {
          projectPreSyncDirty = true;
          continue;
        }
        cancelProjectPreSync();
        projectPreSyncDirty = false;
        return result;
      } catch (error) {
        if (projectEditGeneration === generation) {
          projectPreSyncDirty = true;
        }
        throw error;
      }
    }
    projectPreSyncDirty = true;
    throw new Error(
      "Overleaf 项目在最终同步期间仍在编辑，未能取得稳定版本，请停止输入后重试。",
    );
  }

  async function openCodexDialog(force) {
    try {
      const [snapshotResult, project] = await Promise.all([
        extensionMessage({ type: "capture_selection" }),
        extensionMessage({ type: "get_overleaf_project_context" }),
      ]).catch(async (error) => {
        const projectOnly = await extensionMessage({
          type: "get_overleaf_project_context",
        });
        return [{ available: false, reason: error.message }, projectOnly];
      });
      const snapshot = snapshotResult?.available ? snapshotResult : null;

      const projectChanged =
        projectKey(state.currentProject) !== projectKey(project);
      if (projectChanged && state.activeJobId && state.busy) {
        bridge(
          "POST",
          `/v1/jobs/${encodeURIComponent(state.activeJobId)}/interrupt`,
          {},
        ).catch(() => {});
      }
      state.currentProject = project;
      if (projectChanged || !state.snapshot) {
        state.snapshot = emptyEditorSnapshot(snapshot);
        resetConversation();
      } else if (snapshot?.rect) {
        state.snapshot.rect = snapshot.rect;
        if (Number.isInteger(snapshot.editorIndex)) {
          state.snapshot.editorIndex = snapshot.editorIndex;
        }
      }
      showDialog(snapshot?.rect || state.snapshot?.rect);
      updateSelectionCards();
      renderHistory();
      if (!state.modelsLoaded) loadModels(false);
    } catch (error) {
      if (force) showTransientError(error.message);
    }
  }

  async function addSelectionReferenceFromEditor(force) {
    try {
      const [snapshot, project] = await Promise.all([
        extensionMessage({ type: "capture_selection" }),
        extensionMessage({ type: "get_overleaf_project_context" }),
      ]);
      if (!snapshot?.available) {
        if (force) {
          showTransientError(
            "请把光标放在 Overleaf 源码编辑器中，选择文字或停在要引用的行。",
          );
        }
        return;
      }
      if (snapshot.text.length > 20_000) {
        showTransientError("单个选区超过 20,000 个字符，请缩小范围后重试。");
        return;
      }
      const reference = makeSelectionReference(snapshot);
      if (!reference) {
        showTransientError("暂时无法识别当前文件路径或选区内容。");
        return;
      }

      const projectChanged =
        projectKey(state.currentProject) !== projectKey(project);
      if (projectChanged && state.activeJobId && state.busy) {
        bridge(
          "POST",
          `/v1/jobs/${encodeURIComponent(state.activeJobId)}/interrupt`,
          {},
        ).catch(() => {});
      }
      state.currentProject = project;
      if (projectChanged || !state.snapshot) {
        state.snapshot = emptyEditorSnapshot(snapshot);
        resetConversation();
      }
      if (state.historyProjectMismatch) {
        showDialog(snapshot.rect);
        showTransientError(
          "当前打开的是其他 Overleaf 项目的历史。请先新建对话，再添加当前项目引用。",
        );
        return;
      }

      const duplicate = state.selectionReferences.find(
        (item) => item.key === reference.key,
      );
      if (duplicate) {
        state.snapshot = duplicate.snapshot;
        showDialog(snapshot.rect);
        addNotice(`此引用已经添加：${selectionReferenceLabel(duplicate)}`, "warning");
        return;
      }

      state.selectionReferences.push(reference);
      state.snapshot = reference.snapshot;
      showDialog(snapshot.rect);
      updateSelectionCards();
      saveCurrentConversation();
      addNotice(`已添加引用：${selectionReferenceLabel(reference)}`, "success");
      renderHistory();
      if (!state.modelsLoaded) loadModels(false);
    } catch (error) {
      if (force) showTransientError(error.message);
    }
  }

  function emptyEditorSnapshot(source = null) {
    const position = Number.isInteger(source?.from) ? source.from : 0;
    return {
      text: "",
      from: position,
      to: position,
      documentLength: Number.isInteger(source?.documentLength)
        ? source.documentLength
        : 0,
      contextBefore: "",
      contextAfter: "",
      anchorBefore: "",
      anchorAfter: "",
      editorIndex: Number.isInteger(source?.editorIndex)
        ? source.editorIndex
        : 0,
      viewAvailable: false,
      rect: source?.rect || null,
    };
  }

  function resetConversation() {
    state.snapshot = emptyEditorSnapshot(state.snapshot);
    state.threadId = null;
    state.activeJobId = null;
    state.eventSequence = 0;
    state.candidateStates = [];
    state.projectContext = null;
    state.historyProjectMismatch = false;
    state.busy = false;
    state.activeConversationId = null;
    state.conversationMessages = [];
    state.resumeHistory = [];
    state.attachedFiles = [];
    state.pendingMessages = [];
    state.selectionReferences = [];
    state.activeTurnSelectionReferences = [];
    ui.textarea.value = "";
    resizeComposer();
    renderAttachedFiles();
    renderPendingMessages();
    ui.messages.replaceChildren();
    addMessage(
      "assistant",
      "编辑暂停后会预同步 Overleaf 变化，发送前再做最终校验。按 ⌘/Ctrl + Shift + I 可以连续添加多个文件或行号引用。",
      { persist: false },
    );
    shadow.querySelector(".window-title span").textContent = "新对话";
    hideMentionMenu();
    setBusy(false);
  }

  function beginNewChat() {
    if (state.settingsOpen) closeInlineSettings();
    if (state.activeJobId && state.busy) {
      bridge("POST", `/v1/jobs/${encodeURIComponent(state.activeJobId)}/interrupt`, {}).catch(
        () => {},
      );
    }
    resetConversation();
    shadow.querySelector(".window-title span").textContent = "新对话";
    setHistoryOpen(false);
    ui.textarea.focus();
  }

  async function loadHistory() {
    const response = await extensionMessage({ type: "chat_history_list" });
    const conversations = Array.isArray(response.conversations)
      ? response.conversations
      : [];
    const active = state.history.find(
      (item) => item.id === state.activeConversationId,
    );
    state.history =
      active && state.busy
        ? [
            active,
            ...conversations.filter((item) => item.id !== active.id),
          ]
        : conversations;
    renderHistory();
  }

  function setHistoryOpen(open) {
    state.historyOpen = Boolean(open);
    ui.dialog.classList.toggle("history-open", state.historyOpen);
    ui.historySidebar.setAttribute("aria-hidden", String(!state.historyOpen));
    ui.historyButton.classList.toggle("active", state.historyOpen);
    ui.historyButton.setAttribute("aria-expanded", String(state.historyOpen));
    if (state.historyOpen) loadHistory().catch(showError);
  }

  async function openInlineSettings() {
    setHistoryOpen(false);
    state.settingsPreviousSubtitle =
      shadow.querySelector(".window-title span").textContent || "新对话";
    state.settingsOpen = true;
    ui.dialog.classList.add("settings-open");
    ui.settingsPane.hidden = false;
    ui.settingsButton.classList.add("active");
    shadow.querySelector(".window-title span").textContent = "设置";
    ui.modelPanel.hidden = true;
    hideMentionMenu();
    setAttachmentMenuOpen(false);
    setSettingsStatus("正在读取设置…");
    loadShortcutSettings().catch((error) => {
      ui.shortcutOpen.textContent = "读取失败";
      ui.shortcutReference.textContent = "读取失败";
      console.warn("Unable to read Chrome shortcuts:", error);
    });

    try {
      const settings = await extensionMessage({ type: "get_settings" });
      ui.settingsBridgeUrl.value =
        settings.bridgeUrl || "http://127.0.0.1:47831";
      ui.settingsBridgeToken.value = settings.bridgeToken || "";

      if (!settings.bridgeToken) {
        ui.settingsHistoryDirectory.value = "";
        ui.settingsHistoryDirectory.placeholder =
          "~/.codex/sessions/overleaf-codex";
        ui.settingsHistoryHint.textContent =
          "填写桥接 Token 后可读取或修改目录。";
        ui.settingsWorkspaceDirectory.value = "";
        ui.settingsWorkspaceDirectory.placeholder =
          "~/.overleaf-codex/codex-workspace";
        ui.settingsWorkspaceHint.textContent =
          "填写桥接 Token 后可读取或修改目录。";
        setSettingsStatus("填写桥接 Token 后保存即可连接本机 Codex。");
        return;
      }

      const [historyResult, workspaceResult] = await Promise.allSettled([
        extensionMessage({ type: "history_config_get" }),
        extensionMessage({ type: "workspace_config_get" }),
      ]);
      if (!state.settingsOpen) return;
      if (historyResult.status === "fulfilled") {
        applyHistoryConfig(historyResult.value);
      } else {
        ui.settingsHistoryHint.textContent =
          `暂时无法读取：${historyResult.reason.message}`;
      }
      if (workspaceResult.status === "fulfilled") {
        applyWorkspaceConfig(workspaceResult.value);
      } else {
        ui.settingsWorkspaceHint.textContent =
          `暂时无法读取：${workspaceResult.reason.message}`;
      }
      const failures = [historyResult, workspaceResult].filter(
        (result) => result.status === "rejected",
      );
      setSettingsStatus(
        failures.length
          ? "部分桥接设置未能读取；你仍可修改连接信息并重试。"
          : "",
        failures.length ? "error" : "",
      );
    } catch (error) {
      setSettingsStatus(error.message, "error");
    }
  }

  async function loadShortcutSettings() {
    const result = await extensionMessage({ type: "get_shortcuts" });
    const shortcuts = new Map(
      (result.shortcuts || []).map((shortcut) => [
        shortcut.name,
        shortcut.shortcut || "未设置",
      ]),
    );
    ui.shortcutOpen.textContent =
      shortcuts.get("open-codex-dialog") || "未设置";
    ui.shortcutReference.textContent =
      shortcuts.get("add-selection-reference") || "未设置";
  }

  async function openShortcutSettings() {
    try {
      await extensionMessage({ type: "open_shortcut_settings" });
      setSettingsStatus(
        "已打开 Chrome 快捷键页面；修改后重新打开设置即可刷新显示。",
        "success",
      );
    } catch (error) {
      setSettingsStatus(
        `无法自动打开。请手动访问 chrome://extensions/shortcuts：${error.message}`,
        "error",
      );
    }
  }

  function closeInlineSettings(focusChat = true) {
    if (!state.settingsOpen) return;
    state.settingsOpen = false;
    ui.dialog.classList.remove("settings-open");
    ui.settingsPane.hidden = true;
    ui.settingsButton.classList.remove("active");
    shadow.querySelector(".window-title span").textContent =
      state.settingsPreviousSubtitle || "新对话";
    if (focusChat) ui.textarea.focus();
  }

  async function saveInlineSettings(testConnection) {
    setSettingsControlsDisabled(true);
    setSettingsStatus(testConnection ? "正在保存并测试连接…" : "正在保存…");
    try {
      const bridgeToken = ui.settingsBridgeToken.value.trim();
      await extensionMessage({
        type: "save_connection_settings",
        bridgeUrl: ui.settingsBridgeUrl.value.trim(),
        bridgeToken,
      });
      if (!bridgeToken) {
        throw new Error("请先填写桥接 Token。");
      }
      const [historyConfig, workspaceConfig] = await Promise.all([
        extensionMessage({
          type: "history_config_set",
          directory: ui.settingsHistoryDirectory.value.trim(),
        }),
        extensionMessage({
          type: "workspace_config_set",
          directory: ui.settingsWorkspaceDirectory.value.trim(),
        }),
      ]);
      applyHistoryConfig(historyConfig);
      applyWorkspaceConfig(workspaceConfig);
      if (testConnection) {
        const health = await extensionMessage({
          type: "bridge_request",
          request: { method: "GET", path: "/v1/health" },
        });
        setSettingsStatus(
          `连接成功，桥接服务版本 ${health.version}。`,
          "success",
        );
      } else {
        setSettingsStatus("设置已保存。", "success");
      }
    } catch (error) {
      setSettingsStatus(error.message, "error");
    } finally {
      setSettingsControlsDisabled(false);
    }
  }

  function applyHistoryConfig(config) {
    ui.settingsHistoryDirectory.value = config.isDefault
      ? ""
      : config.directory;
    ui.settingsHistoryDirectory.placeholder = config.defaultDirectory;
    ui.settingsHistoryHint.textContent = `历史文件：${config.filePath}`;
  }

  function applyWorkspaceConfig(config) {
    ui.settingsWorkspaceDirectory.value = config.isDefault
      ? ""
      : config.directory;
    ui.settingsWorkspaceDirectory.placeholder = config.defaultDirectory;
    ui.settingsWorkspaceHint.textContent =
      `项目镜像目录：${config.directory}`;
  }

  function setSettingsStatus(message, type = "") {
    ui.settingsStatus.textContent = message;
    ui.settingsStatus.className = `settings-status${type ? ` ${type}` : ""}`;
  }

  function setSettingsControlsDisabled(disabled) {
    for (const element of ui.settingsPane.querySelectorAll(
      "input, button",
    )) {
      element.disabled = disabled;
    }
  }

  function renderHistory() {
    ui.historyList.replaceChildren();
    const projectConversations = state.history.filter((conversation) =>
      Boolean(projectKey(conversation.project)),
    );
    ui.historyEmpty.hidden = projectConversations.length > 0;
    const groups = new Map();
    for (const conversation of projectConversations) {
      const key = projectKey(conversation.project);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          project: conversation.project || null,
          conversations: [],
          updatedAt: 0,
        });
      }
      const group = groups.get(key);
      group.conversations.push(conversation);
      group.updatedAt = Math.max(
        group.updatedAt,
        Number(conversation.updatedAt) || 0,
      );
    }

    const currentKey = projectKey(state.currentProject);
    const sortedGroups = Array.from(groups.values()).sort((left, right) => {
      if (left.key === currentKey) return -1;
      if (right.key === currentKey) return 1;
      return right.updatedAt - left.updatedAt;
    });

    for (const group of sortedGroups) {
      const section = document.createElement("section");
      section.className = "history-group";
      section.classList.toggle("current", group.key === currentKey);

      const heading = document.createElement("div");
      heading.className = "history-group-heading";
      const projectName = document.createElement("span");
      projectName.className = "history-project-name";
      projectName.textContent = projectLabel(group.project);
      projectName.title = projectName.textContent;
      const count = document.createElement("span");
      count.className = "history-project-count";
      count.textContent = String(group.conversations.length);
      heading.append(projectName, count);
      if (group.key === currentKey) {
        const badge = document.createElement("span");
        badge.className = "history-current-badge";
        badge.textContent = "当前项目";
        heading.append(badge);
      }
      section.append(heading);

      const rows = document.createElement("div");
      rows.className = "history-group-rows";
      for (const conversation of group.conversations) {
        rows.append(createHistoryRow(conversation));
      }
      section.append(rows);
      ui.historyList.append(section);
    }
  }

  function createHistoryRow(conversation) {
      const row = document.createElement("div");
      row.className = "history-row";
      row.classList.toggle(
        "active",
        conversation.id === state.activeConversationId,
      );
      row.classList.toggle(
        "running",
        state.busy && conversation.id === state.activeConversationId,
      );

      const open = document.createElement("button");
      open.type = "button";
      open.className = "history-item";
      open.title = conversation.title;
      open.disabled =
        state.busy && conversation.id !== state.activeConversationId;
      const title = document.createElement("span");
      title.className = "history-title";
      title.textContent = conversation.title;
      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent =
        state.busy && conversation.id === state.activeConversationId
          ? "运行中"
          : formatHistoryTime(conversation.updatedAt);
      open.append(title, time);
      open.addEventListener("click", () => {
        if (state.busy && conversation.id === state.activeConversationId) {
          setHistoryOpen(false);
          return;
        }
        openConversation(conversation.id);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "history-delete";
      remove.title = "删除对话";
      remove.disabled =
        state.busy && conversation.id === state.activeConversationId;
      remove.setAttribute("aria-label", `删除对话：${conversation.title}`);
      remove.innerHTML = ICONS.trash;
      remove.addEventListener("click", () => deleteConversation(conversation.id));
      row.append(open, remove);
      return row;
  }

  function openConversation(id) {
    const conversation = state.history.find((item) => item.id === id);
    if (!conversation || state.busy) return;
    const conversationProjectKey = projectKey(conversation.project);
    const currentProjectKey = projectKey(state.currentProject);
    state.historyProjectMismatch = Boolean(
      conversationProjectKey &&
        currentProjectKey &&
        conversationProjectKey !== currentProjectKey,
    );
    state.activeConversationId = conversation.id;
    state.threadId = null;
    state.activeJobId = null;
    state.eventSequence = 0;
    state.candidateStates = [];
    state.projectContext = null;
    state.selectionReferences = restoreSelectionReferences(conversation);
    state.snapshot =
      state.selectionReferences.at(-1)?.snapshot ||
      conversation.snapshot ||
      emptyEditorSnapshot(state.snapshot);
    state.attachedFiles = Array.isArray(conversation.files)
      ? conversation.files.map((file) => ({ ...file }))
      : [];
    state.pendingMessages = [];
    state.conversationMessages = (conversation.messages || []).map((message) => ({
      ...message,
    }));
    state.resumeHistory = state.conversationMessages.map((message) => ({
      role: message.role,
      text: message.text,
    }));
    if (conversation.model) state.selectedModelId = conversation.model;
    if (conversation.effort) state.selectedEffort = conversation.effort;

    ui.textarea.value = "";
    resizeComposer();
    hideMentionMenu();
    ui.messages.replaceChildren();
    if (state.conversationMessages.length) {
      for (const message of state.conversationMessages) {
        addMessage(message.role, message.text, {
          persist: false,
          references: message.references,
          files: message.files,
        });
      }
    } else {
      addMessage("assistant", "这个历史对话还没有消息。", { persist: false });
    }
    if (state.historyProjectMismatch) {
      addNotice(
        `此对话属于“${projectLabel(conversation.project)}”。请打开对应的 Overleaf 项目后再继续发送。`,
        "warning",
      );
    }
    shadow.querySelector(".window-title span").textContent = conversation.title;
    updateSelectionCards();
    renderAttachedFiles();
    renderPendingMessages();
    if (state.modelsLoaded) renderModelPicker();
    updateModelButton();
    setBusy(false);
    renderHistory();
    setHistoryOpen(false);
    ui.textarea.focus();
  }

  async function deleteConversation(id) {
    const conversation = state.history.find((item) => item.id === id);
    if (!conversation) return;
    if (
      !window.confirm(
        `确定删除历史对话“${conversation.title}”吗？此操作无法撤销。`,
      )
    ) {
      return;
    }
    if (id === state.activeConversationId) beginNewChat();
    state.history = state.history.filter((item) => item.id !== id);
    renderHistory();
    try {
      const response = await extensionMessage({ type: "chat_history_delete", id });
      state.history = response.conversations || state.history;
      renderHistory();
    } catch (error) {
      showError(error);
      loadHistory().catch(() => {});
    }
  }

  function ensureConversation(firstMessage) {
    if (state.activeConversationId) return;
    const now = Date.now();
    state.activeConversationId =
      globalThis.crypto?.randomUUID?.() ||
      `overleaf-${now}-${Math.random().toString(36).slice(2)}`;
    state.conversationMessages = [];
    state.resumeHistory = [];
    const title = makeConversationTitle(firstMessage);
    shadow.querySelector(".window-title span").textContent = title;
    state.history.unshift({
      id: state.activeConversationId,
      title,
      createdAt: now,
      updatedAt: now,
      threadId: null,
      workspaceId: state.activeConversationId,
      model: state.selectedModelId,
      effort: state.selectedEffort,
      project: state.currentProject,
      snapshot: state.snapshot,
      selectionReferences: state.selectionReferences,
      files: state.attachedFiles,
      messages: [],
    });
    renderHistory();
  }

  function saveCurrentConversation() {
    if (!state.activeConversationId) return;
    const existing = state.history.find(
      (item) => item.id === state.activeConversationId,
    );
    const now = Date.now();
    const conversation = {
      id: state.activeConversationId,
      title: existing?.title || makeConversationTitle(""),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      threadId: state.threadId,
      workspaceId: state.activeConversationId,
      model: state.selectedModelId,
      effort: state.selectedEffort,
      project: state.currentProject,
      snapshot: state.snapshot,
      selectionReferences: state.selectionReferences,
      files: state.attachedFiles,
      messages: state.conversationMessages.slice(-100),
    };
    state.history = [
      conversation,
      ...state.history.filter((item) => item.id !== conversation.id),
    ];
    renderHistory();
    state.historySaveChain = state.historySaveChain
      .catch(() => {})
      .then(() =>
        extensionMessage({
          type: "chat_history_save",
          conversation,
        }),
      )
      .catch((error) =>
        console.warn("Unable to save Overleaf Codex history:", error),
      );
  }

  function makeConversationTitle(firstMessage) {
    const fromMessage = String(firstMessage || "")
      .replace(/(^|\s)@[A-Za-z0-9._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const fromSelection = String(
      state.selectionReferences[0]?.snapshot?.text ||
        state.snapshot?.text ||
        "",
    )
      .replace(/\s+/g, " ")
      .trim();
    const fromFile = state.attachedFiles[0]?.name || "";
    const title = fromMessage || fromSelection || fromFile || "新对话";
    return title.length > 34 ? `${title.slice(0, 34)}…` : title;
  }

  function formatHistoryTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return "";
    const now = new Date();
    const date = new Date(timestamp);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((startToday - startDate) / 86_400_000);
    if (days <= 0) return "今天";
    if (days === 1) return "昨天";
    if (days < 7) return `${days} 天前`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function projectKey(project) {
    if (!project || typeof project !== "object") return "";
    if (typeof project.workspaceId === "string" && project.workspaceId) {
      return project.workspaceId;
    }
    if (project.origin && project.projectId) {
      return `${project.origin}|${project.projectId}`;
    }
    return typeof project.projectId === "string" ? project.projectId : "";
  }

  function projectLabel(project) {
    return (
      String(project?.projectName || "").trim() ||
      String(project?.projectId || "").trim() ||
      "Overleaf project"
    );
  }

  function makeSelectionReference(snapshot, suppliedId = null) {
    if (!snapshot || typeof snapshot.text !== "string") return null;
    const relativePath =
      typeof snapshot.filePath === "string" && snapshot.filePath.trim()
        ? snapshot.filePath.trim().replaceAll("\\", "/").replace(/^\/+/, "")
        : null;
    const hasLineRange =
      relativePath &&
      Number.isInteger(snapshot.lineStart) &&
      Number.isInteger(snapshot.lineEnd) &&
      snapshot.lineStart >= 1 &&
      snapshot.lineEnd >= snapshot.lineStart;
    if (!hasLineRange && !snapshot.text) return null;
    const name =
      snapshot.fileName ||
      relativePath?.split("/").at(-1) ||
      `Overleaf 选区 ${state.selectionReferences.length + 1}`;
    const key = hasLineRange
      ? `${relativePath}:${snapshot.lineStart}:${snapshot.lineEnd}`
      : [
          `editor-${snapshot.editorIndex || 0}`,
          Number.isInteger(snapshot.from) ? snapshot.from : "",
          Number.isInteger(snapshot.to) ? snapshot.to : "",
          snapshot.text,
        ].join(":");
    return {
      id:
        suppliedId ||
        globalThis.crypto?.randomUUID?.() ||
        `reference-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      key,
      name,
      relativePath,
      startLine: hasLineRange ? snapshot.lineStart : null,
      endLine: hasLineRange ? snapshot.lineEnd : null,
      snapshot: { ...snapshot },
    };
  }

  function restoreSelectionReferences(conversation) {
    const restored = [];
    for (const item of Array.isArray(conversation?.selectionReferences)
      ? conversation.selectionReferences
      : []) {
      const reference = makeSelectionReference(
        item?.snapshot || item,
        typeof item?.id === "string" ? item.id : null,
      );
      if (reference && !restored.some((existing) => existing.key === reference.key)) {
        restored.push(reference);
      }
    }
    if (
      !restored.length &&
      conversation?.selectionAttached !== false &&
      conversation?.snapshot?.text
    ) {
      const legacy = makeSelectionReference(conversation.snapshot);
      if (legacy) restored.push(legacy);
    }
    return restored;
  }

  function selectionReferenceLabel(reference) {
    if (!reference) return "当前 Overleaf 选区";
    const lines =
      Number.isInteger(reference.startLine) &&
      reference.startLine === reference.endLine
        ? `第 ${reference.startLine} 行`
        : Number.isInteger(reference.startLine) &&
            Number.isInteger(reference.endLine)
          ? `第 ${reference.startLine}–${reference.endLine} 行`
          : "已选择文字";
    return `${reference.relativePath || reference.name} ${lines}`;
  }

  function cloneSelectionReferences(references = state.selectionReferences) {
    return references.map((reference) => ({
      ...reference,
      snapshot: { ...reference.snapshot },
    }));
  }

  function selectionRequestContext(references = state.selectionReferences) {
    return {
      selection: "",
      selectionReference: null,
      selectionReferences: references.map((reference) => ({
        id: reference.id,
        name: reference.name,
        relativePath: reference.relativePath,
        startLine: reference.startLine,
        endLine: reference.endLine,
        text:
          reference.snapshot?.text ||
          reference.snapshot?.lineText ||
          "",
        contextBefore: reference.snapshot?.contextBefore || "",
        contextAfter: reference.snapshot?.contextAfter || "",
      })),
      contextBefore: "",
      contextAfter: "",
    };
  }

  function removeSelectionReference(id) {
    state.selectionReferences = state.selectionReferences.filter(
      (reference) => reference.id !== id,
    );
    state.snapshot =
      state.selectionReferences.at(-1)?.snapshot ||
      emptyEditorSnapshot(state.snapshot);
    updateSelectionCards();
    saveCurrentConversation();
    ui.textarea.focus();
  }

  function toggleAttachmentMenu() {
    if (state.busy) return;
    setAttachmentMenuOpen(ui.attachmentMenu.hidden);
  }

  function setAttachmentMenuOpen(open) {
    ui.attachmentMenu.hidden = !open;
    ui.attachmentTrigger.setAttribute("aria-expanded", String(open));
    if (open) {
      ui.modelPanel.hidden = true;
      hideMentionMenu();
    }
  }

  async function addCurrentFile() {
    if (state.busy) return;
    setAttachmentMenuOpen(false);
    ui.addCurrentFile.disabled = true;
    try {
      const file = await extensionMessage({
        type: "capture_current_file",
        preferredEditorIndex: state.snapshot?.editorIndex,
      });
      if (!file?.available) {
        throw new Error("无法读取当前文件。请先在 Overleaf 源码编辑器中打开文件。");
      }
      const key = `${file.editorIndex}:${file.name}`;
      const existing = state.attachedFiles.find((item) => item.id === key);
      const sha256 = await hashText(file.content);
      const attachment = {
        id: key,
        name: String(file.name || "当前文件").slice(0, 200),
        relativePath:
          typeof file.relativePath === "string"
            ? file.relativePath.slice(0, 1_000)
            : null,
        content: file.content,
        length: file.length,
        sha256,
        editorIndex: file.editorIndex,
        capturedAt: file.capturedAt,
      };
      state.attachedFiles = [
        attachment,
        ...state.attachedFiles.filter((item) => item.id !== key),
      ];
      renderAttachedFiles();
      saveCurrentConversation();
      addNotice(
        existing
          ? `已刷新重点文件：${attachment.name}`
          : `已将当前文件设为重点上下文：${attachment.name}`,
        "success",
      );
    } catch (error) {
      showError(error);
    } finally {
      ui.addCurrentFile.disabled = false;
      ui.textarea.focus();
    }
  }

  async function hashText(value) {
    if (!globalThis.crypto?.subtle) {
      throw new Error("当前 Chrome 环境不支持文件哈希，无法安全同步文件。");
    }
    const bytes = new TextEncoder().encode(String(value));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  function removeAttachedFile(id) {
    if (state.busy) return;
    state.attachedFiles = state.attachedFiles.filter((file) => file.id !== id);
    renderAttachedFiles();
    saveCurrentConversation();
  }

  function renderAttachedFiles() {
    ui.attachedFiles.replaceChildren();
    ui.attachedFiles.hidden = state.attachedFiles.length === 0;
    for (const file of state.attachedFiles) {
      const chip = document.createElement("span");
      chip.className = "file-chip";
      chip.title = `${file.name} · ${Number(file.length || file.content?.length || 0).toLocaleString()} 字符`;
      const icon = document.createElement("span");
      icon.className = "file-chip-icon";
      icon.innerHTML = ICONS.context;
      const name = document.createElement("span");
      name.className = "file-chip-name";
      name.textContent = file.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "file-chip-remove";
      remove.textContent = "×";
      remove.title = `移除 ${file.name}`;
      remove.setAttribute("aria-label", `移除 ${file.name}`);
      remove.disabled = state.busy;
      remove.addEventListener("click", () => removeAttachedFile(file.id));
      chip.append(icon, name, remove);
      ui.attachedFiles.append(chip);
    }
  }

  function interruptActiveTurn() {
    if (!state.activeJobId) return;
    ui.send.disabled = true;
    bridge("POST", `/v1/jobs/${encodeURIComponent(state.activeJobId)}/interrupt`, {})
      .catch(showError)
      .finally(() => {
        if (state.busy) ui.send.disabled = false;
      });
  }

  function showDialog(rect) {
    host.style.display = "block";
    positionDialog(rect);
    window.requestAnimationFrame(() => positionDialog(rect));
  }

  function closeDialog() {
    if (state.activeJobId && state.busy) {
      bridge("POST", `/v1/jobs/${encodeURIComponent(state.activeJobId)}/interrupt`, {}).catch(
        () => {},
      );
    }
    closeInlineSettings(false);
    host.style.display = "none";
  }

  function positionDialog(rect) {
    host.style.position = "fixed";
    host.style.zIndex = "2147483647";

    if (state.maximized) {
      applyHostBounds({
        left: 10,
        top: 10,
        width: Math.max(300, window.innerWidth - 20),
        height: Math.max(360, window.innerHeight - 20),
      });
      return;
    }

    const maxWidth = Math.max(300, window.innerWidth - 24);
    const maxHeight = Math.max(360, window.innerHeight - 24);
    if (!state.dialogSize) {
      state.dialogSize = {
        width: Math.min(420, maxWidth),
        height: Math.min(620, maxHeight),
      };
    }
    const width = Math.min(Math.max(300, state.dialogSize.width), maxWidth);
    const height = Math.min(Math.max(360, state.dialogSize.height), maxHeight);
    state.dialogSize = { width, height };

    let left;
    let top;
    if (state.userPositioned && state.dialogPosition) {
      left = state.dialogPosition.left;
      top = state.dialogPosition.top;
    } else {
      left = rect?.right ? rect.right + 12 : window.innerWidth - width - 20;
      top = rect?.bottom ? rect.bottom + 10 : 64;
      if (left + width > window.innerWidth - 12) {
        left = Math.max(12, (rect?.left || window.innerWidth) - width - 12);
      }
      if (top + height > window.innerHeight - 12) {
        top = Math.max(12, (rect?.top || window.innerHeight) - height - 10);
      }
    }

    left = clamp(left, 8, Math.max(8, window.innerWidth - width - 8));
    top = clamp(top, 8, Math.max(8, window.innerHeight - height - 8));
    state.dialogPosition = { left, top };
    applyHostBounds({ left, top, width, height });
  }

  function applyHostBounds({ left, top, width, height }) {
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
  }

  function updateSelectionCards() {
    ui.selectionReferences.replaceChildren();
    ui.selectionReferences.hidden = state.selectionReferences.length === 0;
    ui.addSelectionReference.hidden = false;
    ui.addSelectionReference.disabled = state.historyProjectMismatch;
    for (const reference of state.selectionReferences) {
      const card = document.createElement("div");
      card.className = "selection-reference";
      const icon = document.createElement("span");
      icon.className = "selection-reference-icon";
      icon.innerHTML = ICONS.context;
      const content = document.createElement("span");
      content.className = "selection-reference-content";
      const file = document.createElement("strong");
      file.className = "selection-reference-file";
      const range = document.createElement("small");
      range.className = "selection-reference-range";
      const path = reference.relativePath || reference.name || "Overleaf 选区";
      const extension =
        path.split(".").at(-1)?.toUpperCase().slice(0, 8) || "TEXT";
      const rangeLabel =
        Number.isInteger(reference.startLine) &&
        Number.isInteger(reference.endLine)
          ? reference.startLine === reference.endLine
          ? `${extension} · ${reference.startLine}`
          : `${extension} · ${reference.startLine}–${reference.endLine}`
        : `${extension} · 已选择文字`;
      file.textContent = path;
      range.textContent = rangeLabel;
      content.append(file, range);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "selection-reference-remove";
      remove.title = "移除选区引用";
      remove.setAttribute("aria-label", `移除引用：${path}`);
      remove.textContent = "×";
      remove.disabled = state.historyProjectMismatch;
      remove.addEventListener("click", () =>
        removeSelectionReference(reference.id),
      );
      card.title = `${selectionReferenceLabel(reference)}${
        reference.snapshot?.text ? `\n\n${reference.snapshot.text}` : ""
      }`;
      card.append(icon, content, remove);
      ui.selectionReferences.append(card);
    }
  }

  async function loadPlugins(force) {
    ui.mentionMenu.hidden = false;
    ui.mentionList.replaceChildren(makeLoading("正在读取本机 Codex 插件…"));
    try {
      const response = await bridge(
        "GET",
        `/v1/plugins${force ? "?force=true" : ""}`,
      );
      state.plugins = response.plugins || [];
      state.pluginsLoaded = true;
      updateMentionMenu();
      return true;
    } catch (error) {
      state.pluginsLoaded = false;
      ui.mentionList.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "picker-empty error-text";
      empty.textContent = error.message;
      ui.mentionList.append(empty);
      return false;
    }
  }

  function updateMentionMenu() {
    if (state.busy) {
      hideMentionMenu();
      return;
    }
    const context = getMentionContext();
    if (!context) {
      hideMentionMenu();
      return;
    }

    setAttachmentMenuOpen(false);
    ui.mentionMenu.hidden = false;
    if (!state.pluginsLoaded) {
      ui.mentionList.replaceChildren(makeLoading("正在读取本机 Codex 插件…"));
      loadPlugins(false);
      return;
    }

    const query = context.query.toLocaleLowerCase();
    state.mentionMatches = state.plugins.filter((plugin) => {
      const searchable = `${plugin.name} ${plugin.displayName} ${plugin.description}`.toLocaleLowerCase();
      return !query || searchable.includes(query);
    });
    state.mentionIndex = Math.min(
      state.mentionIndex,
      Math.max(0, state.mentionMatches.length - 1),
    );
    renderMentionMatches();
  }

  function renderMentionMatches() {
    ui.mentionList.replaceChildren();
    if (!state.mentionMatches.length) {
      const empty = document.createElement("div");
      empty.className = "picker-empty";
      empty.textContent = "没有匹配的已安装插件。";
      ui.mentionList.append(empty);
      return;
    }

    state.mentionMatches.forEach((plugin, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mention-item";
      button.classList.toggle("active", index === state.mentionIndex);

      const title = document.createElement("span");
      title.className = "mention-title";
      title.textContent = `@${plugin.name}`;
      const description = document.createElement("span");
      description.className = "mention-description";
      description.textContent = plugin.description || plugin.capabilities.join(" · ") || "Codex 插件";
      const name = document.createElement("span");
      name.className = "mention-display-name";
      name.textContent = plugin.displayName;
      button.append(title, name, description);

      button.addEventListener("mouseenter", () => {
        state.mentionIndex = index;
        updateMentionActiveItem();
      });
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        insertPluginMention(plugin);
      });
      ui.mentionList.append(button);
    });
  }

  function getMentionContext() {
    const caret = ui.textarea.selectionStart;
    if (!Number.isInteger(caret)) return null;
    const before = ui.textarea.value.slice(0, caret);
    const match = before.match(/(?:^|[\s([{])@([A-Za-z0-9._-]*)$/);
    if (!match) return null;
    return {
      start: before.lastIndexOf("@"),
      end: caret,
      query: match[1] || "",
    };
  }

  function moveMentionSelection(delta) {
    if (!state.mentionMatches.length) return;
    state.mentionIndex =
      (state.mentionIndex + delta + state.mentionMatches.length) %
      state.mentionMatches.length;
    updateMentionActiveItem();
  }

  function updateMentionActiveItem() {
    const items = Array.from(ui.mentionList.querySelectorAll(".mention-item"));
    items.forEach((item, index) => item.classList.toggle("active", index === state.mentionIndex));
    items[state.mentionIndex]?.scrollIntoView({ block: "nearest" });
  }

  function insertPluginMention(plugin) {
    const context = getMentionContext();
    if (!context) return;
    const value = ui.textarea.value;
    const insertion = `@${plugin.name} `;
    ui.textarea.value =
      value.slice(0, context.start) + insertion + value.slice(context.end);
    const caret = context.start + insertion.length;
    ui.textarea.setSelectionRange(caret, caret);
    resizeComposer();
    ui.textarea.focus();
    hideMentionMenu();
  }

  function hideMentionMenu() {
    ui.mentionMenu.hidden = true;
    state.mentionMatches = [];
    state.mentionIndex = 0;
  }

  function mentionedPluginIds(message) {
    return state.plugins
      .filter((plugin) => {
        const token = escapeRegExp(plugin.name);
        return new RegExp(`(^|[\\s([{])@${token}(?![A-Za-z0-9._-])`, "i").test(
          message,
        );
      })
      .map((plugin) => plugin.id);
  }

  async function toggleModelPanel() {
    ui.modelPanel.hidden = !ui.modelPanel.hidden;
    hideMentionMenu();
    setAttachmentMenuOpen(false);
    if (!ui.modelPanel.hidden && !state.modelsLoaded) await loadModels(false);
  }

  async function loadModels(force) {
    state.modelsLoading = true;
    ui.modelButton.disabled = true;
    ui.modelButtonLabel.textContent = "读取模型…";
    if (!ui.modelPanel.hidden) {
      ui.modelList.replaceChildren(makeLoading("正在读取模型…"));
      ui.effortList.replaceChildren();
    }

    try {
      const [response, settings] = await Promise.all([
        bridge("GET", `/v1/models${force ? "?force=true" : ""}`),
        extensionMessage({ type: "get_settings" }),
      ]);
      state.models = response.models || [];
      if (!state.models.length) throw new Error("Codex 没有返回可用模型。");
      state.modelsLoaded = true;

      const preferredModel = state.selectedModelId || settings.model;
      const selectedModel =
        state.models.find(
          (item) => item.model === preferredModel || item.id === preferredModel,
        ) ||
        state.models.find((item) => item.isDefault) ||
        state.models[0];
      const preferredEffort = state.selectedEffort || settings.reasoningEffort;
      selectModel(selectedModel.model, preferredEffort, false);
      return true;
    } catch (error) {
      state.modelsLoaded = false;
      ui.modelButtonLabel.textContent = "模型不可用";
      if (!ui.modelPanel.hidden) {
        const empty = document.createElement("div");
        empty.className = "picker-empty error-text";
        empty.textContent = error.message;
        ui.modelList.replaceChildren(empty);
        ui.effortList.replaceChildren();
      }
      return false;
    } finally {
      state.modelsLoading = false;
      ui.modelButton.disabled = false;
    }
  }

  function selectModel(modelId, preferredEffort = null, persist = true) {
    const model = state.models.find(
      (item) => item.model === modelId || item.id === modelId,
    );
    if (!model) return;
    state.selectedModelId = model.model;
    const supported = model.supportedReasoningEfforts || [];
    state.selectedEffort = supported.some(
      (option) => option.reasoningEffort === preferredEffort,
    )
      ? preferredEffort
      : model.defaultReasoningEffort;
    renderModelPicker();
    updateModelButton();
    if (persist) saveModelPreferences();
  }

  function selectEffort(effort) {
    const model = selectedModel();
    if (
      !model?.supportedReasoningEfforts.some(
        (option) => option.reasoningEffort === effort,
      )
    ) {
      return;
    }
    state.selectedEffort = effort;
    renderModelPicker();
    updateModelButton();
    ui.modelPanel.hidden = true;
    saveModelPreferences();
  }

  function selectedModel() {
    return state.models.find((item) => item.model === state.selectedModelId) || null;
  }

  function renderModelPicker() {
    ui.modelList.replaceChildren();
    for (const model of state.models) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "picker-item model-item";
      button.classList.toggle("selected", model.model === state.selectedModelId);
      const title = document.createElement("strong");
      title.textContent = model.displayName;
      const description = document.createElement("span");
      description.textContent = model.description;
      const check = document.createElement("span");
      check.className = "picker-check";
      check.textContent = model.model === state.selectedModelId ? "✓" : "";
      button.append(title, description, check);
      button.addEventListener("click", () =>
        selectModel(model.model, state.selectedEffort),
      );
      ui.modelList.append(button);
    }

    ui.effortList.replaceChildren();
    const model = selectedModel();
    for (const option of model?.supportedReasoningEfforts || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "picker-item effort-item";
      button.classList.toggle(
        "selected",
        option.reasoningEffort === state.selectedEffort,
      );
      const title = document.createElement("strong");
      title.textContent = effortLabel(option.reasoningEffort);
      const description = document.createElement("span");
      description.textContent = option.description;
      const check = document.createElement("span");
      check.className = "picker-check";
      check.textContent =
        option.reasoningEffort === state.selectedEffort ? "✓" : "";
      button.append(title, description, check);
      button.addEventListener("click", () =>
        selectEffort(option.reasoningEffort),
      );
      ui.effortList.append(button);
    }
  }

  function updateModelButton() {
    const model = selectedModel();
    ui.modelButtonLabel.textContent = model
      ? `${model.displayName} · ${effortLabel(state.selectedEffort)}`
      : "选择模型";
  }

  function effortLabel(effort) {
    return EFFORT_LABELS[effort] || effort || "默认";
  }

  function saveModelPreferences() {
    extensionMessage({
      type: "save_preferences",
      model: state.selectedModelId || "",
      reasoningEffort: state.selectedEffort || "",
    }).catch(showError);
  }

  function startDialogDrag(event) {
    if (
      event.button !== 0 ||
      state.maximized ||
      event.target.closest?.("button")
    ) {
      return;
    }
    event.preventDefault();
    const startRect = host.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    ui.topbar.classList.add("dragging");

    const move = (moveEvent) => {
      const left = clamp(
        startRect.left + moveEvent.clientX - startX,
        8,
        Math.max(8, window.innerWidth - startRect.width - 8),
      );
      const top = clamp(
        startRect.top + moveEvent.clientY - startY,
        8,
        Math.max(8, window.innerHeight - startRect.height - 8),
      );
      state.userPositioned = true;
      state.dialogPosition = { left, top };
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    };
    const stop = () => {
      ui.topbar.classList.remove("dragging");
      removePointerListeners(move, stop);
    };
    addPointerListeners(move, stop);
  }

  function toggleMaximize() {
    if (!state.maximized) {
      const rect = host.getBoundingClientRect();
      state.restoreBounds = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      state.maximized = true;
      ui.dialog.classList.add("maximized");
      ui.maximize.innerHTML = ICONS.restore;
      ui.maximize.title = "还原";
      ui.maximize.setAttribute("aria-label", "还原");
      positionDialog(null);
      return;
    }

    state.maximized = false;
    ui.dialog.classList.remove("maximized");
    ui.maximize.innerHTML = ICONS.maximize;
    ui.maximize.title = "最大化";
    ui.maximize.setAttribute("aria-label", "最大化");
    const bounds = state.restoreBounds;
    if (bounds) {
      state.dialogSize = { width: bounds.width, height: bounds.height };
      state.dialogPosition = { left: bounds.left, top: bounds.top };
      state.userPositioned = true;
    }
    positionDialog(null);
  }

  function startDialogResize(event) {
    if (state.maximized) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.currentTarget.dataset.direction || "se";
    const startRect = host.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const minWidth = Math.min(320, window.innerWidth - 16);
    const minHeight = Math.min(380, window.innerHeight - 16);

    const move = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      let left = startRect.left;
      let top = startRect.top;
      let width = startRect.width;
      let height = startRect.height;

      if (direction.includes("e")) {
        width = clamp(
          startRect.width + deltaX,
          minWidth,
          window.innerWidth - startRect.left - 8,
        );
      }
      if (direction.includes("s")) {
        height = clamp(
          startRect.height + deltaY,
          minHeight,
          window.innerHeight - startRect.top - 8,
        );
      }
      if (direction.includes("w")) {
        width = clamp(
          startRect.width - deltaX,
          minWidth,
          startRect.right - 8,
        );
        left = startRect.right - width;
      }
      if (direction.includes("n")) {
        height = clamp(
          startRect.height - deltaY,
          minHeight,
          startRect.bottom - 8,
        );
        top = startRect.bottom - height;
      }

      state.userPositioned = true;
      state.dialogSize = { width, height };
      state.dialogPosition = { left, top };
      applyHostBounds({ left, top, width, height });
    };
    const stop = () => {
      removePointerListeners(move, stop);
    };
    addPointerListeners(move, stop);
  }

  function addPointerListeners(move, stop) {
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
  }

  function removePointerListeners(move, stop) {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", stop, true);
    window.removeEventListener("pointercancel", stop, true);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function resizeComposer() {
    ui.textarea.style.height = "auto";
    ui.textarea.style.height = `${Math.min(ui.textarea.scrollHeight, 120)}px`;
  }

  async function sendCurrentMessage() {
    if (state.historyProjectMismatch) {
      addNotice("请先打开这段历史所属的 Overleaf 项目。", "warning");
      return;
    }
    const message = ui.textarea.value.trim();
    if (!message) return;
    ui.textarea.value = "";
    resizeComposer();
    hideMentionMenu();
    updateSendButton();
    if (state.busy) {
      queuePendingMessage(message);
      return;
    }
    await sendMessage(message);
  }

  function queuePendingMessage(message) {
    state.pendingMessages.push({
      id:
        globalThis.crypto?.randomUUID?.() ||
        `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: message,
      sending: false,
      phase: null,
    });
    renderPendingMessages();
  }

  function renderPendingMessages() {
    ui.pendingMessages.replaceChildren();
    ui.pendingMessages.hidden = state.pendingMessages.length === 0;
    for (const pending of state.pendingMessages) {
      const row = document.createElement("div");
      row.className = "pending-message";
      row.classList.toggle("sending", pending.sending);

      const marker = document.createElement("span");
      marker.className = "pending-message-marker";
      marker.textContent = "↳";

      const text = document.createElement("span");
      text.className = "pending-message-text";
      text.textContent = pending.text;
      text.title = pending.text;

      const action = document.createElement("button");
      action.type = "button";
      action.className = "pending-steer-button";
      action.disabled =
        pending.sending || (state.busy && !state.activeJobId);
      action.textContent = pending.sending
        ? pending.phase === "syncing"
          ? "同步中…"
          : "Steer 中…"
        : state.busy
          ? state.activeJobId
            ? "↪ Steer"
            : "等待…"
          : "发送";
      action.title = state.busy
        ? state.activeJobId
          ? "立即追加到当前 turn"
          : "当前 turn 正在启动"
        : "作为下一次 turn 发送";
      action.addEventListener("click", () => {
        if (state.busy) steerPendingMessage(pending.id);
        else sendPendingMessage(pending.id);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pending-delete-button";
      remove.disabled = pending.sending;
      remove.title = "删除待发送消息";
      remove.setAttribute("aria-label", "删除待发送消息");
      remove.innerHTML = ICONS.trash;
      remove.addEventListener("click", () => removePendingMessage(pending.id));

      row.append(marker, text, action, remove);
      ui.pendingMessages.append(row);
    }
  }

  function removePendingMessage(id) {
    state.pendingMessages = state.pendingMessages.filter(
      (pending) => pending.id !== id,
    );
    renderPendingMessages();
  }

  async function steerPendingMessage(id) {
    const pending = state.pendingMessages.find((item) => item.id === id);
    if (!pending || pending.sending) return;
    if (!state.busy || !state.activeJobId) {
      await sendPendingMessage(id);
      return;
    }
    const jobId = state.activeJobId;
    let projectSynced = false;
    pending.sending = true;
    pending.phase = "syncing";
    renderPendingMessages();
    try {
      const project = await syncProjectForTurn();
      projectSynced = true;
      state.projectContext = project;
      state.currentProject = {
        projectId: project.projectId || state.currentProject?.projectId || null,
        projectName:
          project.projectName ||
          state.currentProject?.projectName ||
          "Overleaf project",
        origin: state.currentProject?.origin || null,
        workspaceId:
          project.workspaceId ||
          state.currentProject?.workspaceId ||
          null,
      };
      saveCurrentConversation();

      if (!state.busy || state.activeJobId !== jobId) {
        pending.sending = false;
        pending.phase = null;
        renderPendingMessages();
        await sendPendingMessage(id);
        return;
      }

      pending.phase = "steering";
      renderPendingMessages();
      const steerReferences = cloneSelectionReferences();
      const selectionContext = selectionRequestContext(steerReferences);
      await bridge(
        "POST",
        `/v1/jobs/${encodeURIComponent(jobId)}/steer`,
        {
          message: pending.text,
          selectionReference: selectionContext.selectionReference,
          selectionReferences: selectionContext.selectionReferences,
        },
      );
      if (steerReferences.length) {
        state.activeTurnSelectionReferences = steerReferences;
      }
      removePendingMessage(id);
      addMessage("user", pending.text, { references: steerReferences });
      saveCurrentConversation();
      const thinking = ui.messages.querySelector(".thinking:not(.completed)");
      if (thinking) {
        addThinkingSteer(thinking, pending.text);
        setThinkingLabel(thinking, "Codex 已收到补充消息…");
      }
    } catch (error) {
      pending.sending = false;
      pending.phase = null;
      renderPendingMessages();
      if (projectSynced && (!state.busy || state.activeJobId !== jobId)) {
        await sendPendingMessage(id);
      } else {
        showError(error);
      }
    }
  }

  async function sendPendingMessage(id) {
    if (state.busy) return;
    const pending = state.pendingMessages.find((item) => item.id === id);
    if (!pending || pending.sending) return;
    removePendingMessage(id);
    await sendMessage(pending.text);
  }

  function dispatchNextPendingMessage() {
    if (state.busy) return;
    const pending = state.pendingMessages.find((item) => !item.sending);
    if (pending) sendPendingMessage(pending.id);
  }

  async function sendMessage(message) {
    if (state.busy || !state.currentProject) return;
    const resumeHistory = state.resumeHistory.slice();
    const turnReferences = cloneSelectionReferences();
    const turnFiles = state.attachedFiles.map((file) => ({ ...file }));
    ensureConversation(message);
    addMessage("user", message, {
      references: turnReferences,
      files: turnFiles,
    });
    setBusy(true);
    const thinking = addStatus("正在同步 Overleaf 项目变化…");

    try {
      const modelsReadyPromise = state.modelsLoaded
        ? Promise.resolve(true)
        : loadModels(false);
      const pluginsReadyPromise =
        !message.includes("@") || state.pluginsLoaded
          ? Promise.resolve(true)
          : loadPlugins(false);
      const project = await syncProjectForTurn();
      state.projectContext = project;
      state.currentProject = {
        projectId: project.projectId || state.currentProject?.projectId || null,
        projectName:
          project.projectName ||
          state.currentProject?.projectName ||
          "Overleaf project",
        origin: state.currentProject?.origin || null,
        workspaceId:
          project.workspaceId ||
          state.currentProject?.workspaceId ||
          null,
      };
      setThinkingLabel(
        thinking,
        project.fastPath
          ? `项目已是最新：${Number(project.fileCount || 0).toLocaleString()} 个文件。Codex 正在思考…`
          : `项目已同步：${Number(project.fileCount || 0).toLocaleString()} 个文件，${Number(project.changedCount || 0).toLocaleString()} 个更新。Codex 正在思考…`,
      );
      if (!(await modelsReadyPromise)) {
        throw new Error("无法读取 Codex 模型，请检查本机桥接服务。");
      }
      if (!(await pluginsReadyPromise)) {
        throw new Error("无法读取 Codex 插件，不能解析 @ 提及。");
      }
      const selectionContext = selectionRequestContext(turnReferences);
      const started = await bridge("POST", "/v1/turns", {
        threadId: state.threadId,
        message,
        selection: selectionContext.selection,
        selectionReference: selectionContext.selectionReference,
        selectionReferences: selectionContext.selectionReferences,
        contextBefore: selectionContext.contextBefore,
        contextAfter: selectionContext.contextAfter,
        files: turnFiles.map((file) => ({
          id: file.id,
          name: file.name,
          relativePath: file.relativePath,
          sha256: file.sha256,
          editorIndex: file.editorIndex,
          capturedAt: file.capturedAt,
        })),
        workspaceId: project.workspaceId,
        project: {
          synced: true,
          projectId: project.projectId,
          projectName: project.projectName,
          historyVersion: project.historyVersion,
          syncedAt: project.syncedAt,
          fileCount: project.fileCount,
        },
        pluginIds: mentionedPluginIds(message),
        model: state.selectedModelId || null,
        effort: state.selectedEffort || null,
        history: resumeHistory,
      });
      state.activeTurnSelectionReferences = turnReferences;
      if (turnFiles.length) {
        state.attachedFiles = [];
        renderAttachedFiles();
      }
      state.threadId = started.threadId;
      if (started.project) state.projectContext = started.project;
      state.resumeHistory = [];
      saveCurrentConversation();
      state.activeJobId = started.jobId;
      state.eventSequence = 0;
      renderPendingMessages();
      await pollJob(started.jobId, thinking);
    } catch (error) {
      finishThinking(thinking, "思考已中断", true);
      showError(error);
      state.activeJobId = null;
      setBusy(false);
    }
  }

  async function pollJob(jobId, thinking) {
    while (state.activeJobId === jobId) {
      let job;
      try {
        job = await bridge(
          "GET",
          `/v1/jobs/${encodeURIComponent(jobId)}?after=${state.eventSequence}`,
        );
      } catch (error) {
        finishThinking(thinking, "连接中断", true);
        showError(error);
        state.activeJobId = null;
        setBusy(false);
        return;
      }

      for (const event of job.events || []) {
        state.eventSequence = Math.max(state.eventSequence, event.sequence);
        handleJobEvent(event, thinking);
      }

      if (["completed", "failed", "interrupted"].includes(job.status)) {
        finishThinking(
          thinking,
          job.status === "completed" ? null : job.status === "interrupted" ? "已停止" : "处理失败",
          job.status !== "completed",
        );
        state.activeJobId = null;
        setBusy(false);
        if (job.status === "completed" && state.pendingMessages.length) {
          window.setTimeout(dispatchNextPendingMessage, 0);
        }
        return;
      }
      await delay(250);
    }
  }

  function handleJobEvent(event, thinking) {
    switch (event.type) {
      case "status":
        setThinkingLabel(thinking, event.data.label || "Codex 正在处理…");
        break;
      case "reasoning_started":
        ensureReasoningPart(thinking, event.data.itemId, 0);
        setThinkingLabel(thinking, "Codex 正在思考…");
        setThinkingExpanded(thinking, true);
        break;
      case "reasoning_part":
        ensureReasoningPart(
          thinking,
          event.data.itemId,
          event.data.summaryIndex,
        );
        setThinkingExpanded(thinking, true);
        break;
      case "reasoning_delta":
        appendReasoningDelta(thinking, event.data);
        setThinkingLabel(thinking, latestReasoningLabel(event.data.delta));
        setThinkingExpanded(thinking, true);
        break;
      case "reasoning_completed":
        completeReasoning(thinking, event.data);
        setThinkingLabel(thinking, "Codex 正在整理结果…");
        break;
      case "commentary_started":
        ensureCommentaryPreview(thinking, event.data.itemId);
        setThinkingLabel(thinking, "Codex 正在处理…");
        setThinkingExpanded(thinking, true);
        break;
      case "commentary_delta":
        appendCommentaryDelta(thinking, event.data);
        setThinkingLabel(thinking, latestReasoningLabel(event.data.delta));
        setThinkingExpanded(thinking, true);
        break;
      case "commentary_completed":
        completeCommentaryPreview(thinking, event.data);
        setThinkingLabel(thinking, "Codex 正在继续…");
        break;
      case "steered":
        setThinkingLabel(thinking, "Codex 正在根据补充消息继续…");
        break;
      case "tool_started":
        setThinkingLabel(thinking, formatToolStatus(event.data, false));
        updateThinkingTool(thinking, event.data, "running");
        setThinkingExpanded(thinking, true);
        break;
      case "tool_progress":
        setThinkingLabel(thinking, event.data.message || "插件正在处理…");
        updateThinkingTool(thinking, event.data, "running");
        break;
      case "tool_completed":
        updateThinkingTool(thinking, event.data, "completed");
        setThinkingLabel(thinking, "Codex 正在整理结果…");
        break;
      case "approval":
        setThinkingLabel(thinking, "Codex 正在等待你的确认…");
        addApproval(event.data);
        break;
      case "approval_resolved":
        markApprovalResolved(event.data);
        setThinkingLabel(thinking, "Codex 正在继续…");
        break;
      case "warning":
        addNotice(event.data.message, "warning");
        break;
      case "result":
        finishThinking(thinking);
        showResult(event.data);
        break;
      case "error":
        finishThinking(thinking, "处理失败", true);
        addNotice(event.data.message || "Codex 请求失败。", "error");
        break;
      default:
        break;
    }
    scrollMessages();
  }

  function normalizeMessageReferences(references) {
    if (!Array.isArray(references)) return [];
    return references
      .filter((reference) => reference && typeof reference === "object")
      .map((reference) => ({
        id:
          typeof reference.id === "string" && reference.id
            ? reference.id
            : null,
        name:
          typeof reference.name === "string" && reference.name
            ? reference.name
            : String(reference.relativePath || "Overleaf 引用")
                .split("/")
                .at(-1),
        relativePath:
          typeof reference.relativePath === "string"
            ? reference.relativePath
            : null,
        startLine: Number.isInteger(reference.startLine)
          ? reference.startLine
          : null,
        endLine: Number.isInteger(reference.endLine)
          ? reference.endLine
          : null,
      }));
  }

  function normalizeMessageFiles(files) {
    if (!Array.isArray(files)) return [];
    return files
      .filter((file) => file && typeof file === "object")
      .map((file) => ({
        id: typeof file.id === "string" && file.id ? file.id : null,
        name:
          typeof file.name === "string" && file.name
            ? file.name
            : String(file.relativePath || "Overleaf 文件")
                .split("/")
                .at(-1),
        relativePath:
          typeof file.relativePath === "string" ? file.relativePath : null,
      }));
  }

  function appendMessageContextChip(
    container,
    { name, detail, title, file = false },
  ) {
    const chip = document.createElement("span");
    chip.className = `message-reference${file ? " file" : ""}`;
    chip.title = title;
    const icon = document.createElement("span");
    icon.className = "message-reference-icon";
    icon.innerHTML = ICONS.context;
    const fileName = document.createElement("strong");
    fileName.textContent = name;
    const suffix = document.createElement("span");
    suffix.className = "message-reference-lines";
    suffix.textContent = detail;
    chip.append(icon, fileName, suffix);
    container.append(chip);
  }

  function renderMessageReferences(references, files) {
    const container = document.createElement("div");
    container.className = "message-references";
    container.setAttribute("aria-label", "本条消息上下文");
    for (const reference of references) {
      appendMessageContextChip(container, {
        name:
          reference.name ||
          reference.relativePath?.split("/").at(-1) ||
          "Overleaf 引用",
        detail:
        Number.isInteger(reference.startLine) &&
        Number.isInteger(reference.endLine)
          ? reference.startLine === reference.endLine
            ? String(reference.startLine)
            : `${reference.startLine}–${reference.endLine}`
          : "选区",
        title: selectionReferenceLabel(reference),
      });
    }
    for (const file of files) {
      appendMessageContextChip(container, {
        name:
          file.name ||
          file.relativePath?.split("/").at(-1) ||
          "Overleaf 文件",
        detail: "文件",
        title: `重点文件：${file.relativePath || file.name}`,
        file: true,
      });
    }
    return container;
  }

  function addMessage(
    role,
    text,
    { persist = true, references = [], files = [] } = {},
  ) {
    const messageReferences =
      role === "user" ? normalizeMessageReferences(references) : [];
    const messageFiles = role === "user" ? normalizeMessageFiles(files) : [];
    const wrapper = document.createElement("div");
    wrapper.className = `message ${role}`;
    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = role === "user" ? "你" : "Codex";
    const body = document.createElement("div");
    body.className = "message-body";
    if (
      role === "assistant" &&
      globalThis.OverleafCodexMessageRenderer?.renderInto
    ) {
      globalThis.OverleafCodexMessageRenderer.renderInto(body, text);
    } else {
      body.textContent = text;
    }
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "message-copy";
    copy.title = "复制";
    copy.setAttribute("aria-label", "复制消息");
    copy.innerHTML = ICONS.copy;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.classList.add("copied");
        copy.title = "已复制";
        window.setTimeout(() => {
          copy.classList.remove("copied");
          copy.title = "复制";
        }, 1200);
      } catch (error) {
        showError(error);
      }
    });
    actions.append(copy);
    wrapper.append(label);
    if (messageReferences.length || messageFiles.length) {
      wrapper.append(
        renderMessageReferences(messageReferences, messageFiles),
      );
    }
    wrapper.append(body, actions);
    ui.messages.append(wrapper);
    if (persist && ["user", "assistant"].includes(role)) {
      const message = {
        role,
        text,
        at: Date.now(),
      };
      if (messageReferences.length) {
        message.references = messageReferences;
      }
      if (messageFiles.length) {
        message.files = messageFiles;
      }
      state.conversationMessages.push(message);
      saveCurrentConversation();
    }
    scrollMessages();
    return wrapper;
  }

  function addStatus(text) {
    const status = document.createElement("div");
    status.className = "thinking";
    status.dataset.startedAt = String(Date.now());

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "thinking-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const dot = document.createElement("span");
    dot.className = "thinking-dot";
    const label = document.createElement("span");
    label.className = "thinking-label";
    label.textContent = text;
    const chevron = document.createElement("span");
    chevron.className = "thinking-chevron";
    chevron.textContent = "⌄";
    toggle.append(dot, label, chevron);

    const details = document.createElement("div");
    details.className = "thinking-details";
    details.hidden = true;
    toggle.addEventListener("click", () =>
      setThinkingExpanded(status, !status.classList.contains("expanded")),
    );
    status.append(toggle, details);
    ui.messages.append(status);
    scrollMessages();
    return status;
  }

  function setThinkingLabel(thinking, text) {
    const label = thinking.querySelector(".thinking-label");
    if (label) label.textContent = text;
  }

  function setThinkingExpanded(thinking, expanded) {
    thinking.classList.toggle("expanded", expanded);
    const details = thinking.querySelector(".thinking-details");
    if (details) details.hidden = !expanded;
    thinking
      .querySelector(".thinking-toggle")
      ?.setAttribute("aria-expanded", String(expanded));
  }

  function ensureReasoningPart(thinking, itemId, summaryIndex = 0) {
    const details = thinking.querySelector(".thinking-details");
    const key = `${itemId || "reasoning"}:${summaryIndex || 0}`;
    let part = Array.from(details.querySelectorAll(".reasoning-part")).find(
      (item) => item.dataset.key === key,
    );
    if (part) return part;

    part = document.createElement("div");
    part.className = "reasoning-part";
    part.dataset.key = key;
    const marker = document.createElement("span");
    marker.className = "reasoning-marker";
    const text = document.createElement("div");
    text.className = "reasoning-text";
    part.append(marker, text);
    details.append(part);
    thinking.dataset.hasTrace = "true";
    return part;
  }

  function appendReasoningDelta(thinking, data) {
    const part = ensureReasoningPart(
      thinking,
      data.itemId,
      data.summaryIndex,
    );
    const text = part.querySelector(".reasoning-text");
    text.textContent += data.delta || "";
    scrollMessages();
  }

  function completeReasoning(thinking, data) {
    for (const [index, summary] of (data.summary || []).entries()) {
      const part = ensureReasoningPart(thinking, data.itemId, index);
      const text = part.querySelector(".reasoning-text");
      if (!text.textContent.trim()) text.textContent = summary;
    }
  }

  function ensureCommentaryPreview(thinking, itemId) {
    const details = thinking.querySelector(".thinking-details");
    const key = itemId || "commentary";
    let item = Array.from(details.querySelectorAll(".commentary-preview")).find(
      (candidate) => candidate.dataset.key === key,
    );
    if (item) return item;
    item = document.createElement("div");
    item.className = "commentary-preview";
    item.dataset.key = key;
    const marker = document.createElement("span");
    marker.className = "commentary-marker";
    marker.textContent = "↳";
    const text = document.createElement("div");
    text.className = "commentary-text";
    item.append(marker, text);
    details.append(item);
    thinking.dataset.hasTrace = "true";
    return item;
  }

  function appendCommentaryDelta(thinking, data) {
    const item = ensureCommentaryPreview(thinking, data.itemId);
    item.querySelector(".commentary-text").textContent += data.delta || "";
    scrollMessages();
  }

  function completeCommentaryPreview(thinking, data) {
    const item = ensureCommentaryPreview(thinking, data.itemId);
    const text = item.querySelector(".commentary-text");
    if (!text.textContent.trim()) text.textContent = data.text || "";
  }

  function latestReasoningLabel(delta) {
    const line = String(delta || "")
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1);
    if (!line) return "Codex 正在思考…";
    return line.length > 42 ? `${line.slice(0, 42)}…` : line;
  }

  function updateThinkingTool(thinking, data, status) {
    const details = thinking.querySelector(".thinking-details");
    const key = `${data.itemId || data.id || data.server || ""}:${data.tool || data.type || ""}`;
    let item = Array.from(details.querySelectorAll(".thinking-tool")).find(
      (candidate) => candidate.dataset.key === key,
    );
    if (!item) {
      item = document.createElement("div");
      item.className = "thinking-tool";
      item.dataset.key = key;
      const dot = document.createElement("span");
      dot.className = "tool-dot";
      const text = document.createElement("span");
      text.className = "thinking-tool-label";
      item.append(dot, text);
      details.append(item);
    }
    item.classList.toggle("completed", status === "completed");
    item.querySelector(".tool-dot")?.classList.toggle(
      "completed",
      status === "completed",
    );
    item.querySelector(".thinking-tool-label").textContent =
      status === "completed"
        ? `${toolName(data)} 已完成`
        : data.message || `${toolName(data)} 正在运行`;
    thinking.dataset.hasTrace = "true";
  }

  function addThinkingSteer(thinking, message) {
    const details = thinking.querySelector(".thinking-details");
    const item = document.createElement("div");
    item.className = "thinking-steer";
    const marker = document.createElement("span");
    marker.textContent = "↳";
    const text = document.createElement("span");
    text.textContent =
      message.length > 90
        ? `已 Steer：${message.slice(0, 90)}…`
        : `已 Steer：${message}`;
    item.append(marker, text);
    details.append(item);
    thinking.dataset.hasTrace = "true";
    setThinkingExpanded(thinking, true);
  }

  function finishThinking(thinking, explicitLabel = null, failed = false) {
    if (thinking.dataset.finished === "true") return;
    thinking.dataset.finished = "true";
    thinking.classList.add("completed");
    thinking.classList.toggle("failed", failed);
    const elapsed = Math.max(
      1,
      Math.round((Date.now() - Number(thinking.dataset.startedAt || Date.now())) / 1000),
    );
    setThinkingLabel(
      thinking,
      explicitLabel || `思考了 ${elapsed} 秒`,
    );
    const details = thinking.querySelector(".thinking-details");
    if (!details.childElementCount) {
      const empty = document.createElement("div");
      empty.className = "thinking-empty";
      empty.textContent = "这个模型没有返回可展示的推理摘要或预览内容。";
      details.append(empty);
    }
    setThinkingExpanded(thinking, false);
  }

  function addNotice(
    text,
    kind = "info",
    {
      actionLabel = null,
      onAction = null,
      autoScroll = true,
    } = {},
  ) {
    const notice = document.createElement("div");
    notice.className = `notice ${kind}`;
    const message = document.createElement("span");
    message.className = "notice-text";
    message.textContent = text;
    notice.append(message);
    if (actionLabel && typeof onAction === "function") {
      notice.classList.add("has-action");
      const action = document.createElement("button");
      action.type = "button";
      action.className = "notice-action";
      action.textContent = actionLabel;
      action.addEventListener("click", onAction);
      notice.append(action);
    }
    ui.messages.append(notice);
    if (autoScroll) scrollMessages();
    return notice;
  }

  function formatToolStatus(data, completed) {
    return `${toolName(data)}${completed ? " 已完成" : " 正在处理…"}`;
  }

  function toolName(data) {
    if (data.server && data.tool) return `${data.server}.${data.tool}`;
    if (data.tool) return data.tool;
    if (data.type === "webSearch") return "网页搜索";
    if (data.type === "commandExecution") return "本机命令";
    return "Codex 工具";
  }

  function addApproval(data) {
    const card = document.createElement("div");
    card.className = "approval-card";
    card.dataset.requestId = data.requestId;

    const title = document.createElement("strong");
    title.textContent = data.title || "Codex 请求确认";
    const description = document.createElement("p");
    description.textContent = data.description || "";
    card.append(title, description);

    if (data.command) {
      const command = document.createElement("code");
      command.textContent = data.command;
      card.append(command);
    }

    if (data.url) {
      const link = document.createElement("a");
      link.href = data.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "打开授权页面";
      card.append(link);
    }

    let input = null;
    if (data.questions?.length || data.schema) {
      input = document.createElement("input");
      input.type = "text";
      input.placeholder = data.questions?.[0]?.question || "填写插件需要的信息";
      card.append(input);
    }

    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "secondary-button";
    reject.textContent = "拒绝";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "approve-button";
    approve.textContent = data.url ? "已完成，继续" : "允许本次";
    actions.append(reject, approve);
    card.append(actions);

    reject.addEventListener("click", () =>
      respondToApproval(data.requestId, "decline", null, card),
    );
    approve.addEventListener("click", () =>
      respondToApproval(
        data.requestId,
        "approve",
        input ? { text: input.value } : {},
        card,
      ),
    );
    ui.messages.append(card);
  }

  async function respondToApproval(requestId, action, content, card) {
    for (const button of card.querySelectorAll("button")) button.disabled = true;
    try {
      await bridge(
        "POST",
        `/v1/jobs/${encodeURIComponent(state.activeJobId)}/requests/${encodeURIComponent(
          requestId,
        )}`,
        { action, content },
      );
    } catch (error) {
      for (const button of card.querySelectorAll("button")) button.disabled = false;
      showError(error);
    }
  }

  function markApprovalResolved(data) {
    const card = Array.from(ui.messages.querySelectorAll(".approval-card")).find(
      (item) => item.dataset.requestId === data.requestId,
    );
    if (!card) return;
    card.classList.add(data.approved ? "approved" : "declined");
    const actions = card.querySelector(".approval-actions");
    if (actions) {
      actions.replaceChildren(
        document.createTextNode(data.approved ? "已允许本次操作" : "已拒绝"),
      );
    }
  }

  function showResult(result) {
    addMessage("assistant", result.message || "已完成。");
    for (const warning of result.warnings || []) addNotice(warning, "warning");
    const resultReferences = state.activeTurnSelectionReferences;
    const candidates = normalizeResultCandidates(result, resultReferences);
    if (!candidates.length) return;
    const grouped = resultReferences.length > 1;
    const groupHosts = new Map();
    const groupCounts = new Map();

    if (grouped) {
      resultReferences.forEach((reference, referenceIndex) => {
        const group = createCandidateGroup(reference, referenceIndex);
        groupHosts.set(referenceIndex, group.list);
        groupCounts.set(referenceIndex, 0);
        ui.messages.append(group.section);
      });
      if (
        candidates.some(
          (candidate) =>
            !Number.isInteger(candidate.referenceIndex) ||
            candidate.referenceIndex < 0 ||
            candidate.referenceIndex >= resultReferences.length,
        )
      ) {
        const group = createCandidateGroup(null, null);
        groupHosts.set("unassigned", group.list);
        groupCounts.set("unassigned", 0);
        ui.messages.append(group.section);
      }
    }

    candidates.forEach((candidateData, index) => {
      const reference =
        Number.isInteger(candidateData.referenceIndex) &&
        candidateData.referenceIndex >= 0 &&
        candidateData.referenceIndex < resultReferences.length
          ? resultReferences[candidateData.referenceIndex]
          : null;
      const groupKey = reference ? candidateData.referenceIndex : "unassigned";
      const groupNumber = (groupCounts.get(groupKey) || 0) + 1;
      groupCounts.set(groupKey, groupNumber);
      const initialSnapshot = reference?.snapshot
        ? { ...reference.snapshot }
        : null;
      const candidate = {
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}`,
        text: candidateData.text,
        label: candidateData.label,
        referenceIndex: candidateData.referenceIndex,
        reference,
        targetKey: reference?.id || null,
        initialSnapshot,
        beforeSnapshot: null,
        afterSnapshot: null,
        applied: false,
        applying: false,
        card: null,
        applyButton: null,
      };

      const card = document.createElement("div");
      card.className = "candidate-card";
      const heading = document.createElement("div");
      heading.className = "candidate-heading";
      const title = document.createElement("strong");
      title.textContent =
        candidate.label ||
        (candidates.length > 1
          ? `建议 ${grouped ? groupNumber : index + 1}`
          : "Codex 建议修改");
      heading.append(title);
      if (reference && !grouped) {
        const target = document.createElement("span");
        target.className = "candidate-target";
        target.textContent = selectionReferenceLabel(reference);
        target.title = target.textContent;
        heading.append(target);
      }
      const preview = document.createElement("pre");
      preview.textContent = candidate.text;
      const actions = document.createElement("div");
      actions.className = "candidate-actions";
      const diffButton = actionButton("查看差异", "secondary-button");
      const copyButton = actionButton("复制", "secondary-button");
      const applyButton = actionButton("应用到 Overleaf", "apply-button");
      candidate.card = card;
      candidate.applyButton = applyButton;
      state.candidateStates.push(candidate);
      updateCandidateButton(candidate);
      actions.append(diffButton, copyButton, applyButton);
      card.append(heading, preview, actions);
      (grouped
        ? groupHosts.get(groupKey) || ui.messages
        : ui.messages
      ).append(card);

      diffButton.disabled = !initialSnapshot?.text;
      diffButton.addEventListener("click", () => {
        if (initialSnapshot?.text) {
          showDiff(candidate, initialSnapshot.text, candidate.text);
        }
      });
      copyButton.addEventListener("click", async () => {
        centerCandidate(candidate);
        try {
          await navigator.clipboard.writeText(candidate.text);
          copyButton.textContent = "已复制";
          window.setTimeout(() => {
            copyButton.textContent = "复制";
          }, 1200);
        } catch (error) {
          showError(error);
        }
      });
      applyButton.addEventListener("click", () => {
        centerCandidate(candidate);
        return candidate.applied
          ? undoCandidate(candidate)
          : applyCandidate(candidate);
      });
    });
    if (grouped) {
      for (const [key, list] of groupHosts) {
        if (groupCounts.get(key)) continue;
        const empty = document.createElement("div");
        empty.className = "candidate-group-empty";
        empty.textContent = "Codex 本次没有为这段引用返回替换建议。";
        list.append(empty);
      }
    }
    scrollMessages();
  }

  function createCandidateGroup(reference, referenceIndex) {
    const section = document.createElement("section");
    section.className = "candidate-group";
    const header = document.createElement("div");
    header.className = "candidate-group-header";
    const title = document.createElement("strong");
    title.textContent = reference
      ? `引用 ${referenceIndex + 1}`
      : "未定位建议";
    const target = document.createElement("span");
    target.className = "candidate-group-target";
    target.textContent = reference
      ? selectionReferenceLabel(reference)
      : "未找到对应的引用位置";
    target.title = target.textContent;
    header.append(title, target);
    section.append(header);

    if (reference?.snapshot?.text) {
      const source = document.createElement("pre");
      source.className = "candidate-group-source";
      source.setAttribute("aria-label", `${title.textContent}原文`);
      source.textContent = String(reference.snapshot.text).slice(0, 2_000);
      section.append(source);
    }

    const list = document.createElement("div");
    list.className = "candidate-group-list";
    section.append(list);
    return { section, list };
  }

  function normalizeResultCandidates(result, references) {
    const candidates = [];
    const seen = new Set();
    for (const item of Array.isArray(result?.replacements)
      ? result.replacements
      : []) {
      if (!item || typeof item.text !== "string") continue;
      const referenceIndex = Number.isInteger(item.referenceIndex)
        ? item.referenceIndex
        : null;
      const key = `${referenceIndex ?? "none"}\u0000${item.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        text: item.text,
        referenceIndex,
        label:
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : null,
      });
    }
    if (
      typeof result?.replacement === "string" &&
      !candidates.some((candidate) => candidate.text === result.replacement)
    ) {
      const referenceIndex = references.length === 1 ? 0 : null;
      candidates.push({
        text: result.replacement,
        referenceIndex,
        label: null,
      });
    }
    return candidates;
  }

  function showDiff(candidate, original, replacement) {
    const card = candidate.card;
    let diff = card.querySelector(".diff-view");
    if (diff) {
      diff.remove();
      centerCandidate(candidate);
      return;
    }
    diff = document.createElement("div");
    diff.className = "diff-view";
    for (const part of wordDiff(original, replacement)) {
      const span = document.createElement(
        part.type === "delete" ? "del" : part.type === "insert" ? "ins" : "span",
      );
      span.textContent = part.text;
      diff.append(span);
    }

    const warnings = validateLatex(original, replacement);
    if (warnings.length) {
      const warningList = document.createElement("ul");
      warningList.className = "latex-warnings";
      for (const warning of warnings) {
        const item = document.createElement("li");
        item.textContent = warning;
        warningList.append(item);
      }
      diff.append(warningList);
    }
    card.insertBefore(diff, card.querySelector(".candidate-actions"));
    centerCandidate(candidate);
  }

  function candidateSnapshot(candidate) {
    if (!candidate.reference) return null;
    const id = candidate.reference.id;
    return (
      state.selectionReferences.find((reference) => reference.id === id)
        ?.snapshot ||
      state.activeTurnSelectionReferences.find(
        (reference) => reference.id === id,
      )?.snapshot ||
      candidate.reference.snapshot ||
      null
    );
  }

  function snapshotAfterReplacement(snapshot, replacement) {
    const previousText = String(snapshot?.text || "");
    const next = {
      ...snapshot,
      text: replacement,
      to: snapshot.from + replacement.length,
      documentLength:
        (Number.isInteger(snapshot.documentLength)
          ? snapshot.documentLength
          : previousText.length) +
        replacement.length -
        previousText.length,
    };
    if (Number.isInteger(snapshot.lineStart)) {
      next.lineEnd =
        snapshot.lineStart + Math.max(0, replacement.split("\n").length - 1);
    }
    return next;
  }

  function updateCandidateTarget(candidate, snapshot) {
    candidate.reference.snapshot = { ...snapshot };
    for (const reference of state.selectionReferences) {
      if (reference.id === candidate.reference.id) {
        reference.snapshot = { ...snapshot };
      }
    }
    for (const reference of state.activeTurnSelectionReferences) {
      if (reference.id === candidate.reference.id) {
        reference.snapshot = { ...snapshot };
      }
    }
    for (const item of state.candidateStates) {
      if (item.targetKey === candidate.targetKey && item.reference) {
        item.reference.snapshot = { ...snapshot };
      }
    }
    state.snapshot = { ...snapshot };
  }

  function updateCandidateButton(candidate) {
    const button = candidate.applyButton;
    if (!button) return;
    const snapshot = candidateSnapshot(candidate);
    const canApply = Boolean(
      candidate.reference &&
        snapshot?.viewAvailable &&
        typeof snapshot.text === "string",
    );
    const canUndo = Boolean(
      candidate.applied &&
        candidate.beforeSnapshot &&
        candidate.afterSnapshot,
    );
    button.disabled =
      candidate.applying || (candidate.applied ? !canUndo : !canApply);
    if (candidate.applying) {
      button.textContent = candidate.applied ? "正在撤销…" : "正在应用…";
    } else if (candidate.applied) {
      button.textContent = "撤销应用";
    } else if (canApply) {
      button.textContent = "应用到 Overleaf";
    } else if (!candidate.reference) {
      button.textContent = "目标引用不可用";
    } else if (state.attachedFiles.length) {
      button.textContent = "文件仅作上下文";
    } else {
      button.textContent = "无法自动写回";
    }
  }

  function refreshCandidateButtons(targetKey) {
    for (const candidate of state.candidateStates) {
      if (!targetKey || candidate.targetKey === targetKey) {
        updateCandidateButton(candidate);
      }
    }
  }

  function centerCandidate(
    candidate,
    { highlight = false, focus = false, smooth = true } = {},
  ) {
    if (!candidate?.card?.isConnected) {
      showError(new Error("对应建议已经不在当前对话界面中。"));
      return;
    }
    let spacer = ui.messages.querySelector(".candidate-center-spacer");
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.className = "candidate-center-spacer";
      spacer.setAttribute("aria-hidden", "true");
      ui.messages.append(spacer);
    }
    spacer.style.height = "0px";
    window.requestAnimationFrame(() => {
      const cardRect = candidate.card.getBoundingClientRect();
      const messagesRect = ui.messages.getBoundingClientRect();
      const target =
        ui.messages.scrollTop +
        cardRect.top -
        messagesRect.top -
        (ui.messages.clientHeight - cardRect.height) / 2;
      const currentMaximum =
        ui.messages.scrollHeight - ui.messages.clientHeight;
      if (target > currentMaximum) {
        spacer.style.height = `${Math.ceil(target - currentMaximum + 8)}px`;
      }
      const scrollTop = Math.max(0, target);
      ui.messages.scrollTo({
        top: scrollTop,
        behavior: smooth ? "smooth" : "auto",
      });
      if (highlight) {
        candidate.card.classList.remove("candidate-located");
        window.requestAnimationFrame(() => {
          candidate.card.classList.add("candidate-located");
          window.setTimeout(
            () => candidate.card?.classList.remove("candidate-located"),
            1800,
          );
        });
      }
      if (focus) candidate.applyButton?.focus({ preventScroll: true });
    });
  }

  function focusCandidate(candidate) {
    centerCandidate(candidate, { highlight: true, focus: true });
  }

  async function applyCandidate(candidate) {
    const snapshot = candidateSnapshot(candidate);
    if (!snapshot?.viewAvailable || typeof snapshot.text !== "string") {
      showError(new Error("这条建议没有可写回的 Overleaf 引用。"));
      return;
    }
    const warnings = validateLatex(snapshot.text, candidate.text);
    if (
      warnings.length &&
      !window.confirm(`检测到可能的 LaTeX 风险：\n\n${warnings.join("\n")}\n\n仍然应用吗？`)
    ) {
      return;
    }
    candidate.applying = true;
    updateCandidateButton(candidate);
    try {
      const result = await extensionMessage({
        type: "apply_replacement",
        snapshot,
        replacement: candidate.text,
      });
      if (!result.applied) {
        throw new Error(
          result.reason === "selection-stale"
            ? "原选区已经变化。为避免覆盖协作者的修改，已停止写回。"
            : "当前编辑器无法自动写回，请复制结果。",
        );
      }
      candidate.beforeSnapshot = { ...snapshot };
      candidate.afterSnapshot = snapshotAfterReplacement(
        snapshot,
        candidate.text,
      );
      for (const item of state.candidateStates) {
        if (item !== candidate && item.targetKey === candidate.targetKey) {
          item.applied = false;
        }
      }
      candidate.applied = true;
      updateCandidateTarget(candidate, candidate.afterSnapshot);
      addNotice(
        "修改已写入 Overleaf；可在该建议卡片中撤销。",
        "success",
        {
          actionLabel: "返回建议",
          onAction: () => focusCandidate(candidate),
          autoScroll: false,
        },
      );
      centerCandidate(candidate);
      updateSelectionCards();
      saveCurrentConversation();
      markProjectDirty();
    } catch (error) {
      showError(error);
      centerCandidate(candidate);
    } finally {
      candidate.applying = false;
      refreshCandidateButtons(candidate.targetKey);
    }
  }

  async function undoCandidate(candidate) {
    if (!candidate.beforeSnapshot || !candidate.afterSnapshot) {
      candidate.applied = false;
      updateCandidateButton(candidate);
      return;
    }
    candidate.applying = true;
    updateCandidateButton(candidate);
    try {
      const result = await extensionMessage({
        type: "apply_replacement",
        snapshot: candidate.afterSnapshot,
        replacement: candidate.beforeSnapshot.text,
      });
      if (!result.applied) {
        throw new Error(
          result.reason === "selection-stale"
            ? "应用后的文字已经变化。为避免覆盖新修改，已停止撤销。"
            : "当前编辑器无法自动撤销，请使用 Overleaf 原生撤销。",
        );
      }
      const restoredSnapshot = { ...candidate.beforeSnapshot };
      candidate.applied = false;
      updateCandidateTarget(candidate, restoredSnapshot);

      const previousCandidate = state.candidateStates
        .filter(
          (item) =>
            item !== candidate &&
            item.targetKey === candidate.targetKey &&
            item.afterSnapshot?.text === restoredSnapshot.text,
        )
        .at(-1);
      if (previousCandidate) previousCandidate.applied = true;
      addNotice(
        "已撤销这条建议，并恢复应用前的 Overleaf 内容。",
        "success",
        {
          actionLabel: "返回建议",
          onAction: () => focusCandidate(candidate),
          autoScroll: false,
        },
      );
      centerCandidate(candidate);
      updateSelectionCards();
      saveCurrentConversation();
      markProjectDirty();
    } catch (error) {
      showError(error);
      centerCandidate(candidate);
    } finally {
      candidate.applying = false;
      refreshCandidateButtons(candidate.targetKey);
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    ui.send.disabled = state.historyProjectMismatch;
    ui.textarea.disabled = state.historyProjectMismatch;
    ui.textarea.placeholder = state.historyProjectMismatch
      ? "请打开此历史所属的 Overleaf 项目"
      : "向 Codex 发送消息";
    ui.modelButton.disabled = state.modelsLoading;
    ui.attachmentTrigger.disabled = busy || state.historyProjectMismatch;
    renderAttachedFiles();
    if (busy) {
      ui.modelPanel.hidden = true;
      hideMentionMenu();
      setAttachmentMenuOpen(false);
    }
    ui.historyButton.disabled = false;
    ui.newChatButton.disabled = busy;
    ui.historyNewChat.disabled = busy;
    ui.settingsButton.disabled = busy;
    updateSelectionCards();
    renderPendingMessages();
    renderHistory();
    updateSendButton();
    if (busy) ui.textarea.focus();
  }

  function updateSendButton() {
    const canQueue = state.busy && Boolean(ui.textarea.value.trim());
    const stopping = state.busy && !canQueue;
    ui.send.classList.toggle("stop-button", stopping);
    ui.send.innerHTML = stopping ? ICONS.stop : ICONS.send;
    const label = stopping
      ? "停止生成"
      : canQueue
        ? "加入待发送队列"
        : "发送";
    ui.send.title = label;
    ui.send.setAttribute("aria-label", label);
  }

  function showError(error) {
    addNotice(error.message || String(error), "error");
  }

  function showTransientError(message) {
    if (host.style.display === "none") {
      host.style.display = "block";
      state.snapshot = state.snapshot || {
        text: "",
        viewAvailable: false,
        rect: null,
      };
      updateSelectionCards();
      positionDialog(null);
    }
    addNotice(message, "error");
  }

  async function bridge(method, path, body) {
    return extensionMessage({
      type: "bridge_request",
      request: { method, path, body },
    });
  }

  async function extensionMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "扩展后台没有响应。");
    return response.result;
  }

  function scrollMessages() {
    ui.messages.querySelector(".candidate-center-spacer")?.remove();
    window.requestAnimationFrame(() => {
      ui.messages.scrollTop = ui.messages.scrollHeight;
    });
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function makeLoading(text) {
    const element = document.createElement("div");
    element.className = "picker-empty";
    element.textContent = text;
    return element;
  }

  function actionButton(text, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    return button;
  }

  function wordDiff(original, replacement) {
    const left = tokenize(original);
    const right = tokenize(replacement);
    if (left.length * right.length > 90_000) return coarseDiff(original, replacement);

    const rows = Array.from({ length: left.length + 1 }, () =>
      new Uint16Array(right.length + 1),
    );
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        rows[i][j] =
          left[i] === right[j]
            ? rows[i + 1][j + 1] + 1
            : Math.max(rows[i + 1][j], rows[i][j + 1]);
      }
    }

    const parts = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        pushPart(parts, "same", left[i]);
        i++;
        j++;
      } else if (rows[i + 1][j] >= rows[i][j + 1]) {
        pushPart(parts, "delete", left[i++]);
      } else {
        pushPart(parts, "insert", right[j++]);
      }
    }
    while (i < left.length) pushPart(parts, "delete", left[i++]);
    while (j < right.length) pushPart(parts, "insert", right[j++]);
    return parts;
  }

  function tokenize(text) {
    return text.match(/\\[A-Za-z@]+\*?|[A-Za-z0-9_]+|\s+|./gs) || [];
  }

  function pushPart(parts, type, text) {
    const previous = parts.at(-1);
    if (previous?.type === type) previous.text += text;
    else parts.push({ type, text });
  }

  function coarseDiff(original, replacement) {
    let prefix = 0;
    while (
      prefix < original.length &&
      prefix < replacement.length &&
      original[prefix] === replacement[prefix]
    ) {
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < original.length - prefix &&
      suffix < replacement.length - prefix &&
      original[original.length - 1 - suffix] === replacement[replacement.length - 1 - suffix]
    ) {
      suffix++;
    }
    return [
      { type: "same", text: original.slice(0, prefix) },
      { type: "delete", text: original.slice(prefix, original.length - suffix) },
      { type: "insert", text: replacement.slice(prefix, replacement.length - suffix) },
      { type: "same", text: original.slice(original.length - suffix) },
    ].filter((part) => part.text);
  }

  function validateLatex(original, replacement) {
    const warnings = [];
    const commandPattern =
      /\\(?:cite|citep|citet|citeauthor|ref|eqref|autoref|cref|Cref|label|begin|end)\*?(?:\[[^\]]*\])*\{[^{}]*\}/g;
    const originalCommands = (original.match(commandPattern) || []).sort();
    const replacementCommands = (replacement.match(commandPattern) || []).sort();
    if (JSON.stringify(originalCommands) !== JSON.stringify(replacementCommands)) {
      warnings.push("引用、交叉引用、标签或环境命令发生了变化。");
    }

    if (braceBalance(replacement) !== 0) {
      warnings.push("候选文本中的花括号可能不配对。");
    }
    if (countUnescapedDollars(original) % 2 !== countUnescapedDollars(replacement) % 2) {
      warnings.push("数学模式的 $ 分隔符可能不配对。");
    }
    for (const [open, close, label] of [
      ["\\(", "\\)", "\\(…\\)"],
      ["\\[", "\\]", "\\[…\\]"],
    ]) {
      if (
        countOccurrences(replacement, open) !== countOccurrences(replacement, close) ||
        countOccurrences(original, open) - countOccurrences(original, close) !==
          countOccurrences(replacement, open) - countOccurrences(replacement, close)
      ) {
        warnings.push(`${label} 数学分隔符可能不配对。`);
      }
    }
    return [...new Set(warnings)];
  }

  function braceBalance(text) {
    let balance = 0;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === "\\" && index + 1 < text.length) {
        index++;
      } else if (text[index] === "{") {
        balance++;
      } else if (text[index] === "}") {
        balance--;
      }
      if (balance < 0) return balance;
    }
    return balance;
  }

  function countUnescapedDollars(text) {
    let count = 0;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === "\\" && index + 1 < text.length) index++;
      else if (text[index] === "$") count++;
    }
    return count;
  }

  function countOccurrences(text, needle) {
    return text.split(needle).length - 1;
  }

  function styles() {
    return `<style>
      :host {
        all: initial;
        color-scheme: light;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      button, textarea, input { font: inherit; }
      button { cursor: pointer; }
      button:disabled { cursor: default; opacity: .55; }
      .model-panel[hidden], .mention-menu[hidden], .attachment-menu[hidden],
      .attached-files[hidden], .selection-references[hidden], .pending-messages[hidden],
      .settings-pane[hidden] { display: none !important; }
      svg {
        width: 18px; height: 18px; fill: none; stroke: currentColor;
        stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
      }
      .dialog {
        width: 100%; height: 100%; position: relative; display: flex; flex-direction: column;
        overflow: hidden; color: #171717; border: 1px solid #dedede; border-radius: 18px;
        background: #fff; box-shadow: 0 20px 70px rgb(0 0 0 / 18%), 0 2px 10px rgb(0 0 0 / 7%);
      }
      .dialog.maximized { border-radius: 14px; }
      .topbar {
        min-height: 50px; display: flex; align-items: center; justify-content: space-between;
        padding: 8px 9px 8px 10px; border-bottom: 1px solid #f0f0f0;
        background: rgb(255 255 255 / 96%); cursor: grab; user-select: none;
      }
      .topbar.dragging { cursor: grabbing; }
      .title-area { min-width: 0; display: flex; align-items: center; gap: 9px; }
      .title-divider { width: 1px; height: 22px; background: #e5e5e5; }
      .window-title { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .window-title strong {
        overflow: hidden; color: #252525; font-size: 12px; font-weight: 620;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .window-title span { color: #8c8c8c; font-size: 9px; }
      .top-actions { display: flex; gap: 2px; }
      .icon-button {
        width: 30px; height: 30px; display: grid; place-items: center; padding: 0;
        color: #555; border: 0; border-radius: 8px; background: transparent;
      }
      .icon-button:hover, .icon-button.active { color: #111; background: #f2f2f2; }
      .dialog-content {
        position: relative; flex: 1 1 auto; min-height: 0; display: flex; overflow: hidden;
      }
      .dialog.settings-open .dialog-content { display: none; }
      .chat-pane {
        min-width: 0; min-height: 0; display: flex; flex: 1 1 auto; flex-direction: column;
        background: white;
      }
      .settings-pane {
        min-height: 0; display: flex; flex: 1 1 auto; overflow: hidden; background: #fafafa;
      }
      .settings-scroll {
        width: min(620px, 100%); min-height: 0; margin: 0 auto; padding: 18px;
        overflow-y: auto; scrollbar-color: #d8d8d8 transparent; scrollbar-width: thin;
      }
      .settings-heading {
        display: flex; align-items: flex-start; gap: 9px; margin: 0 0 15px;
      }
      .settings-heading h2 {
        margin: 2px 0 2px; color: #222; font-size: 15px; font-weight: 680;
      }
      .settings-heading p {
        margin: 0; color: #777; font-size: 9.5px; line-height: 1.45;
      }
      .settings-card {
        margin: 0 0 11px; padding: 14px; border: 1px solid #e3e3e3;
        border-radius: 14px; background: #fff;
      }
      .settings-card-heading {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 10px; margin-bottom: 12px;
      }
      .settings-card-heading h3 {
        margin: 0 0 2px; color: #252525; font-size: 11.5px; font-weight: 680;
      }
      .settings-card-heading p {
        margin: 0; color: #858585; font-size: 9px; line-height: 1.4;
      }
      .local-badge {
        padding: 3px 6px; color: #666; border: 1px solid #dedede;
        border-radius: 999px; background: #f7f7f7; font: 700 7.5px/1 ui-monospace, monospace;
        letter-spacing: .08em;
      }
      .settings-field {
        display: flex; flex-direction: column; gap: 5px; margin-top: 11px;
        color: #333; font-size: 10px; font-weight: 620;
      }
      .settings-field > input, .settings-input-row input {
        width: 100%; height: 35px; min-width: 0; padding: 0 10px;
        color: #222; border: 1px solid #d9d9d9; border-radius: 9px; outline: none;
        background: #fff; font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .settings-field > input:focus, .settings-input-row input:focus {
        border-color: #aaa; box-shadow: 0 0 0 2px rgb(0 0 0 / 5%);
      }
      .settings-field small {
        overflow-wrap: anywhere; color: #8a8a8a; font-size: 8.5px; font-weight: 400;
        line-height: 1.4;
      }
      .settings-input-row { display: flex; gap: 7px; }
      .settings-input-row .secondary-button {
        height: 35px; flex: 0 0 auto; padding: 0 10px; border-radius: 9px; font-size: 9.5px;
      }
      .settings-note {
        margin: 12px 0 0; padding: 8px 9px; color: #686868; border-radius: 9px;
        background: #f7f7f7; font-size: 8.7px; line-height: 1.5;
      }
      .settings-status {
        min-height: 18px; margin: 3px 2px 8px; color: #666; font-size: 9px; line-height: 1.45;
      }
      .settings-status.success { color: #16643f; }
      .settings-status.error { color: #a52a2a; }
      .settings-actions {
        display: flex; justify-content: flex-end; gap: 7px; padding-bottom: 3px;
      }
      .settings-actions button {
        min-height: 34px; padding: 0 13px; border-radius: 9px; font-size: 10px; font-weight: 650;
      }
      .shortcut-list {
        display: flex; flex-direction: column; gap: 7px; margin-bottom: 11px;
      }
      .shortcut-row {
        min-height: 34px; display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 0 9px; color: #444; border-radius: 9px; background: #f7f7f7;
        font-size: 9.5px;
      }
      .shortcut-row kbd {
        max-width: 52%; overflow: hidden; padding: 4px 7px; color: #333;
        border: 1px solid #d8d8d8; border-bottom-width: 2px; border-radius: 6px;
        background: #fff; font: 8.5px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .settings-shortcuts {
        min-height: 34px; padding: 0 11px; border-radius: 9px; font-size: 9.5px;
      }
      .primary-button { color: #fff; border: 1px solid #171717; background: #171717; }
      .primary-button:hover { background: #333; }
      .history-sidebar {
        position: absolute; top: 0; bottom: 0; left: 0; z-index: 45;
        width: min(270px, 86%); display: flex; flex-direction: column; padding: 9px 8px 12px;
        color: #222; border-right: 1px solid #e7e7e7; background: #fff;
        box-shadow: 18px 0 42px rgb(0 0 0 / 10%);
        opacity: 0; pointer-events: none; transform: translateX(-102%);
        transition: transform .18s ease, opacity .18s ease;
      }
      .dialog.history-open .history-sidebar {
        opacity: 1; pointer-events: auto; transform: translateX(0);
      }
      .history-scrim {
        position: absolute; top: 0; right: 0; bottom: 0; left: min(270px, 86%);
        z-index: 44; padding: 0;
        border: 0; background: rgb(0 0 0 / 5%);
        opacity: 0; pointer-events: none; transition: opacity .18s ease;
      }
      .dialog.history-open .history-scrim { opacity: 1; pointer-events: auto; }
      .history-header {
        min-height: 39px; display: flex; align-items: center; gap: 7px; padding: 0 3px 7px;
      }
      .history-header strong { font-size: 12px; font-weight: 680; }
      .history-new-chat {
        min-height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 11px;
        text-align: left; color: #333; border: 0; border-radius: 10px; background: transparent;
        font-size: 11px; font-weight: 580;
      }
      .history-new-chat:hover { background: #f3f3f3; }
      .history-new-chat svg { width: 16px; height: 16px; }
      .history-list {
        min-height: 0; display: flex; flex: 1 1 auto; flex-direction: column;
        gap: 11px; padding: 8px 0; overflow-y: auto;
        scrollbar-color: #d8d8d8 transparent; scrollbar-width: thin;
      }
      .history-group { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
      .history-group-heading {
        min-width: 0; display: flex; align-items: center; gap: 6px; padding: 0 8px 3px;
        color: #888; font-size: 8.5px;
      }
      .history-project-name {
        min-width: 0; overflow: hidden; font-weight: 650;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .history-project-count {
        min-width: 17px; padding: 1px 5px; text-align: center; border-radius: 999px;
        background: #f0f0f0; font-size: 7.5px;
      }
      .history-current-badge {
        margin-left: auto; padding: 2px 5px; color: #555; border: 1px solid #ddd;
        border-radius: 999px; background: #fff; font-size: 7px; white-space: nowrap;
      }
      .history-group.current .history-project-name { color: #333; }
      .history-group-rows { display: flex; flex-direction: column; gap: 2px; }
      .history-row {
        position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 28px;
        align-items: center; border-radius: 9px;
      }
      .history-row:hover, .history-row.active { background: #f3f3f3; }
      .history-item {
        min-width: 0; min-height: 42px; display: grid; grid-template-columns: minmax(0, 1fr) auto;
        align-items: center; gap: 7px; padding: 0 5px 0 11px; text-align: left;
        color: #333; border: 0; background: transparent;
      }
      .history-title {
        overflow: hidden; font-size: 10.5px; font-weight: 540;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .history-row.running .history-title::before {
        content: ""; width: 6px; height: 6px; display: inline-block; margin-right: 6px;
        border-radius: 50%; background: #111; animation: pulse 1.1s infinite;
      }
      .history-time { color: #999; font-size: 8.5px; white-space: nowrap; }
      .history-delete {
        width: 27px; height: 27px; display: grid; place-items: center; padding: 0;
        color: #8b8b8b; border: 0; border-radius: 7px; background: transparent;
        opacity: .35;
      }
      .history-row:hover .history-delete, .history-delete:focus-visible { opacity: 1; }
      .history-delete:disabled { opacity: .15; }
      .history-delete:hover { color: #a32626; background: #fff; }
      .history-delete svg { width: 14px; height: 14px; }
      .history-empty { padding: 25px 8px; color: #999; font-size: 10px; text-align: center; }
      .text-button { padding: 2px 4px; color: #555; border: 0; background: transparent; font-size: 10px; }
      .text-button:hover { color: #111; text-decoration: underline; }
      .messages {
        flex: 1 1 auto; min-height: 90px; display: flex; flex-direction: column;
        gap: 15px; padding: 18px 18px 12px; overflow: auto; overscroll-behavior: contain;
        scrollbar-color: #d8d8d8 transparent; scrollbar-width: thin;
      }
      .candidate-center-spacer {
        width: 1px; min-height: 0; flex: 0 0 auto; pointer-events: none;
      }
      .message { display: flex; flex-direction: column; gap: 4px; }
      .message.user { align-items: flex-end; }
      .message-label {
        display: flex; align-items: center; gap: 7px; color: #575757;
        font-size: 9px; font-weight: 650;
      }
      .message.assistant .message-label::before {
        content: ""; width: 8px; height: 8px; border-radius: 50%; background: #111;
      }
      .message.user .message-label { display: none; }
      .message-body {
        max-width: 100%; min-width: 0; padding: 0 0 0 15px; word-break: break-word;
        border: 0; background: transparent; font-size: 11.5px; line-height: 1.62;
      }
      .message.user .message-body {
        max-width: 84%; padding: 9px 12px; color: #171717; white-space: pre-wrap;
        border-radius: 16px 16px 4px 16px; background: #f2f2f2;
      }
      .message-references {
        max-width: 84%; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px;
      }
      .message-reference {
        min-width: 0; min-height: 28px; display: inline-flex; align-items: center; gap: 5px;
        padding: 4px 9px 4px 7px; color: #333; border: 1px solid #dedede;
        border-radius: 14px; background: #fafafa; font-size: 9.5px; line-height: 1;
      }
      .message-reference-icon {
        width: 18px; height: 18px; display: grid; flex: 0 0 auto; place-items: center;
        color: #686868; border-radius: 6px; background: #efefef;
      }
      .message-reference-icon svg {
        width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.8;
      }
      .message-reference strong {
        min-width: 0; overflow: hidden; font-size: 9.8px; font-weight: 680;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .message-reference-lines { flex: 0 0 auto; color: #777; font-weight: 560; }
      .message.assistant .message-body > :first-child { margin-top: 0; }
      .message.assistant .message-body > :last-child { margin-bottom: 0; }
      .message.assistant .message-body p { margin: 0 0 9px; }
      .message.assistant .message-body h1,
      .message.assistant .message-body h2,
      .message.assistant .message-body h3,
      .message.assistant .message-body h4 {
        margin: 14px 0 7px; color: #222; font-size: 1em; line-height: 1.35;
      }
      .message.assistant .message-body h1 { font-size: 1.18em; }
      .message.assistant .message-body h2 { font-size: 1.1em; }
      .message.assistant .message-body ul,
      .message.assistant .message-body ol {
        margin: 5px 0 10px; padding-left: 21px;
      }
      .message.assistant .message-body li { margin: 3px 0; padding-left: 2px; }
      .message.assistant .message-body li > p { margin: 0; }
      .message.assistant .message-body strong { font-weight: 700; }
      .message.assistant .message-body a {
        color: #1769aa; text-decoration: underline; text-underline-offset: 2px;
      }
      .message.assistant .message-body code {
        padding: 1px 4px; border: 1px solid #e6e6e6; border-radius: 5px;
        background: #f5f5f5; font: .9em/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .message.assistant .message-body pre {
        max-width: 100%; margin: 8px 0 11px; padding: 9px 10px; overflow: auto;
        border: 1px solid #e7e7e7; border-radius: 9px; background: #f7f7f7;
      }
      .message.assistant .message-body pre code {
        padding: 0; border: 0; background: transparent; font-size: 9.7px;
      }
      .message.assistant .message-body blockquote {
        margin: 8px 0; padding: 1px 0 1px 10px; color: #666;
        border-left: 2px solid #d8d8d8;
      }
      .message.assistant .message-body table {
        width: 100%; margin: 8px 0 11px; border-collapse: collapse; font-size: 10.5px;
      }
      .message.assistant .message-body th,
      .message.assistant .message-body td {
        padding: 5px 7px; text-align: left; border: 1px solid #e2e2e2;
      }
      .message.assistant .message-body th { background: #f7f7f7; font-weight: 680; }
      .message.assistant .message-body hr {
        height: 1px; margin: 13px 0; border: 0; background: #e5e5e5;
      }
      .message.assistant .math-render { max-width: 100%; }
      .message.assistant .math-render.display {
        display: block; max-width: 100%; margin: 9px 0; overflow-x: auto; overflow-y: hidden;
      }
      .message.assistant .katex { font-size: 1.02em; }
      .message.assistant .katex-display { margin: 0; text-align: center; }
      .message-actions { min-height: 20px; display: flex; }
      .message.user .message-actions { justify-content: flex-end; }
      .message-copy {
        width: 25px; height: 22px; display: grid; place-items: center; padding: 0;
        color: #888; border: 0; border-radius: 6px; background: transparent;
        opacity: 0; transition: opacity .15s, background .15s;
      }
      .message:hover .message-copy, .message-copy:focus-visible { opacity: 1; }
      .message-copy:hover { color: #222; background: #f2f2f2; }
      .message-copy.copied { color: #15803d; opacity: 1; }
      .message-copy svg { width: 14px; height: 14px; }
      .thinking { color: #666; font-size: 10.5px; }
      .thinking-toggle {
        width: 100%; min-height: 28px; display: flex; align-items: center; gap: 9px;
        padding: 2px 0; text-align: left; color: #666; border: 0; background: transparent;
      }
      .thinking-toggle:hover { color: #222; }
      .thinking-dot {
        width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%;
        background: #111; animation: pulse 1.1s infinite;
      }
      .thinking.completed .thinking-dot { animation: none; }
      .thinking.failed .thinking-dot { background: #b42318; }
      .thinking-label {
        min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .thinking-chevron {
        margin-left: 1px; color: #999; font-size: 12px;
        transition: transform .15s ease;
      }
      .thinking.expanded .thinking-chevron { transform: rotate(180deg); }
      .thinking-details {
        position: relative; display: flex; flex-direction: column; gap: 8px;
        margin: 2px 0 3px 4px; padding: 3px 0 3px 14px;
        border-left: 1px solid #dedede;
      }
      .thinking-details[hidden] { display: none; }
      .reasoning-part {
        display: grid; grid-template-columns: 7px minmax(0, 1fr); gap: 7px;
        color: #737373;
      }
      .reasoning-marker {
        width: 5px; height: 5px; margin-top: 6px; border: 1px solid #999; border-radius: 50%;
      }
      .reasoning-text {
        white-space: pre-wrap; word-break: break-word; font-size: 9.8px; line-height: 1.55;
      }
      .commentary-preview {
        display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 5px;
        color: #666;
      }
      .commentary-marker { color: #999; }
      .commentary-text {
        white-space: pre-wrap; word-break: break-word; font-size: 9.8px; line-height: 1.55;
      }
      .thinking-tool {
        display: flex; align-items: center; gap: 8px; color: #777; font-size: 9.5px;
      }
      .thinking-tool.completed { color: #555; }
      .thinking-steer {
        display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 5px;
        color: #666; font-size: 9.5px; line-height: 1.45;
      }
      .thinking-empty { color: #999; font-size: 9.5px; line-height: 1.45; }
      @keyframes pulse { 50% { opacity: .25; transform: scale(.8); } }
      .notice { padding: 8px 10px; border-radius: 10px; font-size: 10px; line-height: 1.45; }
      .notice.info { color: #455; background: #f4f6f7; }
      .notice.warning { color: #6f5718; background: #fff8df; }
      .notice.error { color: #9b2929; background: #fff0f0; }
      .notice.success { color: #16643f; background: #edf8f1; }
      .notice.has-action { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .notice-text { min-width: 0; }
      .notice-action {
        flex: 0 0 auto; min-height: 25px; padding: 0 8px; color: currentColor;
        border: 1px solid rgb(22 100 63 / 24%); border-radius: 7px; background: rgb(255 255 255 / 64%);
        font-size: 9.5px; font-weight: 650;
      }
      .notice-action:hover { background: #fff; }
      .tool-dot { width: 7px; height: 7px; border: 1.5px solid #999; border-radius: 50%; }
      .tool-dot.completed { border-color: #222; background: #222; }
      .candidate-group {
        display: flex; flex-direction: column; gap: 8px; padding: 10px;
        border: 1px solid #dedede; border-radius: 16px; background: #f7f7f7;
      }
      .candidate-group-header {
        display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 0 2px;
      }
      .candidate-group-header strong { flex: 0 0 auto; color: #222; font-size: 11.5px; }
      .candidate-group-target {
        min-width: 0; overflow: hidden; color: #777; font-size: 9.5px; font-weight: 550;
        text-align: right; text-overflow: ellipsis; white-space: nowrap;
      }
      .candidate-group-source {
        max-height: 58px; margin: 0; padding: 7px 9px; overflow: auto;
        color: #666; border: 1px solid #e5e5e5; border-radius: 9px; background: #fff;
        white-space: pre-wrap; word-break: break-word; font: 9.5px/1.45 ui-monospace, monospace;
      }
      .candidate-group-list { display: flex; flex-direction: column; gap: 8px; }
      .candidate-group-empty {
        padding: 9px; color: #888; border: 1px dashed #d8d8d8; border-radius: 10px;
        background: #fff; font-size: 10px;
      }
      .approval-card, .candidate-card {
        padding: 11px; border: 1px solid #e3e3e3; border-radius: 14px; background: #fff;
      }
      .candidate-card.candidate-located {
        animation: candidate-locate 1.8s ease;
      }
      @keyframes candidate-locate {
        0%, 100% { border-color: #e3e3e3; box-shadow: none; }
        20%, 70% { border-color: #2d8d5b; box-shadow: 0 0 0 3px rgb(45 141 91 / 14%); }
      }
      .approval-card strong, .candidate-card strong { display: block; font-size: 11px; }
      .candidate-heading {
        display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 5px;
      }
      .candidate-target {
        min-width: 0; overflow: hidden; color: #888; font-size: 9.5px; font-weight: 500;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .approval-card p { margin: 0 0 8px; color: #666; font-size: 10px; line-height: 1.45; }
      .approval-card code {
        display: block; max-height: 70px; margin-bottom: 8px; padding: 7px; overflow: auto;
        color: #333; border-radius: 8px; background: #f5f5f5; font: 9.5px/1.45 ui-monospace, monospace;
      }
      .approval-card a { display: inline-block; margin: 0 0 8px; color: #1769aa; font-size: 10.5px; }
      .approval-card input {
        width: 100%; height: 32px; margin-bottom: 8px; padding: 0 8px;
        border: 1px solid #d8d8d8; border-radius: 8px; outline: none; font-size: 11px;
      }
      .approval-card.approved { border-color: #b9dfc5; background: #f3fbf5; }
      .approval-card.declined { opacity: .7; }
      .approval-actions, .candidate-actions { display: flex; justify-content: flex-end; gap: 6px; color: #69786f; font-size: 10px; }
      .approval-actions button, .candidate-actions button {
        min-height: 29px; padding: 0 9px; border-radius: 7px; font-size: 10.5px; font-weight: 650;
      }
      .secondary-button { color: #333; border: 1px solid #ddd; background: white; }
      .secondary-button:hover { background: #f5f5f5; }
      .approve-button, .apply-button { color: white; border: 1px solid #171717; background: #171717; }
      .approve-button:hover, .apply-button:hover { background: #333; }
      .candidate-card pre {
        max-height: 125px; margin: 6px 0 9px; padding: 8px; overflow: auto; white-space: pre-wrap; word-break: break-word;
        color: #333; border-radius: 9px; background: #f6f6f6; font: 10px/1.5 ui-monospace, monospace;
      }
      .diff-view {
        max-height: 150px; margin: 6px 0 9px; padding: 8px; overflow: auto; white-space: pre-wrap; word-break: break-word;
        border: 1px solid #e3e3e3; border-radius: 9px; background: #fafafa; font: 10px/1.55 ui-monospace, monospace;
      }
      .diff-view del { color: #a52323; background: #ffe3e3; }
      .diff-view ins { color: #0d6d3e; background: #dff4e6; text-decoration: none; }
      .latex-warnings { margin: 8px 0 0; padding: 7px 7px 7px 22px; color: #7a5a11; border-radius: 6px; background: #fff5ce; }
      .composer {
        flex: 0 0 auto; position: relative; padding: 4px 12px 12px; background: white;
      }
      .pending-messages {
        max-height: 135px; display: flex; flex-direction: column; gap: 6px;
        margin: 0 0 7px; overflow-y: auto; scrollbar-color: #d8d8d8 transparent;
        scrollbar-width: thin;
      }
      .pending-message {
        min-height: 39px; display: grid;
        grid-template-columns: 18px minmax(0, 1fr) auto 28px;
        align-items: center; gap: 5px; padding: 5px 5px 5px 9px;
        color: #333; border: 1px solid #e2e2e2; border-radius: 13px;
        background: #fff; box-shadow: 0 3px 12px rgb(0 0 0 / 5%);
      }
      .pending-message.sending { opacity: .65; }
      .pending-message-marker { color: #999; font-size: 14px; }
      .pending-message-text {
        min-width: 0; overflow: hidden; font-size: 10.5px;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .pending-steer-button {
        min-height: 27px; padding: 0 7px; color: #666; border: 0;
        border-radius: 7px; background: transparent; font-size: 9.5px;
      }
      .pending-steer-button:hover { color: #111; background: #f2f2f2; }
      .pending-delete-button {
        width: 27px; height: 27px; display: grid; place-items: center;
        padding: 0; color: #888; border: 0; border-radius: 7px; background: transparent;
      }
      .pending-delete-button:hover { color: #a32626; background: #f5f5f5; }
      .pending-delete-button svg { width: 14px; height: 14px; }
      .composer-box {
        position: relative; border: 1px solid #dcdcdc; border-radius: 22px; background: #fff;
        box-shadow: 0 5px 18px rgb(0 0 0 / 7%); transition: border-color .15s, box-shadow .15s;
      }
      .composer-box:focus-within { border-color: #c5c5c5; box-shadow: 0 6px 22px rgb(0 0 0 / 9%); }
      .selection-references {
        max-height: 142px; display: flex; flex-wrap: wrap; gap: 7px;
        margin: 10px 10px 0; overflow-y: auto; scrollbar-width: thin;
      }
      .selection-reference {
        width: min(230px, 100%); min-height: 52px;
        display: grid; grid-template-columns: 38px minmax(0, 1fr) 22px;
        align-items: center; gap: 8px; padding: 6px 5px 6px 7px;
        color: #333; border: 1px solid #d9d9d9; border-radius: 12px; background: #f7f7f7;
      }
      .selection-reference-icon {
        width: 38px; height: 38px; display: grid; place-items: center;
        color: #555; border: 1px solid #e2e2e2; border-radius: 9px; background: #fff;
      }
      .selection-reference-icon svg { width: 19px; height: 19px; }
      .selection-reference-content {
        min-width: 0; display: flex; flex-direction: column; gap: 3px;
      }
      .selection-reference-file {
        overflow: hidden; font-size: 10.5px; font-weight: 680;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .selection-reference-range {
        overflow: hidden; color: #777; font-size: 9px;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .selection-reference-remove {
        width: 21px; height: 21px; align-self: start; padding: 0;
        color: #666; border: 1px solid #d4d4d4; border-radius: 50%; background: #fff;
        font-size: 15px; line-height: 17px;
      }
      .selection-reference-remove:hover { color: #111; background: #ececec; }
      .attached-files {
        display: flex; gap: 6px; padding: 9px 10px 0; overflow-x: auto;
        scrollbar-width: thin;
      }
      .file-chip {
        min-width: 0; max-width: 220px; height: 28px; display: inline-flex; flex: 0 0 auto;
        align-items: center; gap: 5px; padding: 0 5px 0 7px;
        color: #444; border: 1px solid #dedede; border-radius: 9px; background: #f7f7f7;
        font-size: 9.5px;
      }
      .file-chip-icon { width: 14px; height: 14px; display: grid; flex: 0 0 auto; place-items: center; }
      .file-chip-icon svg { width: 13px; height: 13px; }
      .file-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .file-chip-remove {
        width: 20px; height: 20px; padding: 0; color: #888; border: 0;
        border-radius: 50%; background: transparent; font-size: 15px; line-height: 18px;
      }
      .file-chip-remove:hover { color: #111; background: #e8e8e8; }
      .composer-input { position: relative; }
      .composer textarea {
        width: 100%; min-height: 48px; max-height: 120px; resize: none; padding: 13px 14px 5px;
        color: #1d1d1d; border: 0; border-radius: 22px 22px 0 0; outline: none;
        background: transparent; font-size: 11.5px; line-height: 1.5;
      }
      .composer textarea::placeholder { color: #aaa; }
      .mention-menu {
        position: absolute; right: 2px; bottom: calc(100% + 8px); left: 2px; z-index: 30;
        max-height: min(280px, calc(100vh - 180px)); overflow: hidden;
        border: 1px solid #dedede; border-radius: 13px; background: white;
        box-shadow: 0 16px 42px rgb(0 0 0 / 16%);
      }
      .mention-menu-head, .picker-heading {
        display: flex; align-items: center; justify-content: space-between;
        padding: 9px 10px 6px; color: #666; font-size: 10px;
      }
      .mention-list { max-height: 230px; padding: 0 6px 6px; overflow: auto; }
      .mention-item {
        width: 100%; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px;
        padding: 8px 9px; text-align: left; color: #222;
        border: 0; border-radius: 8px; background: transparent;
      }
      .mention-item:hover, .mention-item.active { background: #f2f2f2; }
      .mention-title { color: #333; font: 680 11px/1.3 ui-monospace, monospace; }
      .mention-display-name {
        overflow: hidden; font-size: 11px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap;
      }
      .mention-description {
        grid-column: 1 / -1; overflow: hidden; color: #777;
        font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap;
      }
      .picker-empty { padding: 12px 8px; color: #777; font-size: 10.5px; text-align: center; }
      .composer-footer {
        display: flex; align-items: center; justify-content: space-between; gap: 6px;
        min-height: 38px; padding: 0 7px 7px 8px;
      }
      .composer-left { min-width: 0; display: flex; align-items: center; gap: 6px; }
      .composer-icon {
        width: 29px; height: 29px; display: grid; flex: 0 0 auto; place-items: center;
        padding: 0; color: #555; border: 0; border-radius: 50%; background: transparent;
      }
      .composer-icon:hover { color: #111; background: #f2f2f2; }
      .composer-icon svg { width: 17px; height: 17px; }
      .attachment-menu {
        position: absolute; bottom: calc(100% - 4px); left: 18px; z-index: 36;
        width: 250px; padding: 6px; border: 1px solid #dedede; border-radius: 13px;
        background: #fff; box-shadow: 0 16px 42px rgb(0 0 0 / 17%);
      }
      .attachment-option {
        width: 100%; display: grid; grid-template-columns: 30px minmax(0, 1fr);
        align-items: center; gap: 8px; padding: 8px; text-align: left;
        color: #222; border: 0; border-radius: 9px; background: transparent;
      }
      .attachment-option:hover { background: #f3f3f3; }
      .attachment-option-icon {
        width: 30px; height: 30px; display: grid; place-items: center;
        color: #555; border: 1px solid #e2e2e2; border-radius: 8px; background: #fff;
      }
      .attachment-option-icon svg { width: 15px; height: 15px; }
      .attachment-option strong { display: block; font-size: 10.5px; }
      .attachment-option small { display: block; margin-top: 2px; color: #888; font-size: 8.8px; }
      .composer-hint {
        overflow: hidden; color: #999; font-size: 8.5px; text-overflow: ellipsis; white-space: nowrap;
      }
      .composer-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
      .model-control { position: relative; }
      .model-button {
        max-width: 190px; height: 29px; display: flex; align-items: center; gap: 5px;
        padding: 0 8px; color: #666; border: 0; border-radius: 8px;
        background: transparent; font-size: 9.5px;
      }
      .model-button:hover { color: #111; background: #f2f2f2; }
      .model-button-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .model-panel {
        position: absolute; right: 12px; bottom: calc(100% - 4px); z-index: 35;
        width: calc(100% - 24px); max-width: 520px; max-height: min(360px, calc(100vh - 150px));
        display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, .85fr);
        overflow: hidden; border: 1px solid #dedede; border-radius: 13px; background: white;
        box-shadow: 0 16px 42px rgb(0 0 0 / 17%);
      }
      .model-panel-column { min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
      .effort-column { border-left: 1px solid #ececec; }
      .model-list, .effort-list { min-height: 60px; padding: 2px 6px 7px; overflow: auto; }
      .picker-item {
        position: relative; width: 100%; display: grid; gap: 2px; padding: 8px 25px 8px 9px;
        text-align: left; color: #222; border: 0; border-radius: 8px; background: transparent;
      }
      .picker-item:hover, .picker-item.selected { background: #f2f2f2; }
      .picker-item strong { overflow: hidden; font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
      .picker-item span:not(.picker-check) {
        overflow: hidden; color: #777; font-size: 9px; text-overflow: ellipsis; white-space: nowrap;
      }
      .picker-check {
        position: absolute; top: 50%; right: 9px; color: #222;
        font-size: 11px; transform: translateY(-50%);
      }
      .send-button {
        width: 34px; height: 34px; display: grid; flex: 0 0 auto; place-items: center;
        padding: 0; color: white; border: 0; border-radius: 50%; background: #111;
      }
      .send-button:hover { background: #333; }
      .send-button svg { width: 17px; height: 17px; stroke-width: 2.1; }
      .send-button.stop-button svg { width: 16px; height: 16px; fill: currentColor; stroke: none; }
      .resize-handle {
        position: absolute; z-index: 50; background: transparent;
      }
      .dialog.maximized .resize-handle { display: none; }
      .resize-n, .resize-s { right: 14px; left: 14px; height: 7px; cursor: ns-resize; }
      .resize-n { top: -2px; }
      .resize-s { bottom: -2px; }
      .resize-e, .resize-w { top: 14px; bottom: 14px; width: 7px; cursor: ew-resize; }
      .resize-e { right: -2px; }
      .resize-w { left: -2px; }
      .resize-ne, .resize-nw, .resize-se, .resize-sw { width: 15px; height: 15px; }
      .resize-ne { top: -2px; right: -2px; cursor: nesw-resize; }
      .resize-nw { top: -2px; left: -2px; cursor: nwse-resize; }
      .resize-se { right: -2px; bottom: -2px; cursor: nwse-resize; }
      .resize-sw { bottom: -2px; left: -2px; cursor: nesw-resize; }
      .resize-se::after {
        content: ""; position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px;
        border-right: 1px solid #aaa; border-bottom: 1px solid #aaa; border-radius: 0 0 2px 0;
      }
      .error-text { color: #a52a2a; }
    </style>`;
  }
})();
