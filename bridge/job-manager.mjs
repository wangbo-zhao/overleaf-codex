import { randomUUID } from "node:crypto";
import {
  buildSteerInput,
  buildTurnInput,
  DEVELOPER_INSTRUCTIONS,
  flattenPluginResponse,
  normalizeModels,
  parseStructuredResult,
  RESULT_SCHEMA,
  summarizeToolItem,
} from "./lib.mjs";

const EVENT_LIMIT = 500;

export class JobManager {
  constructor({ client, cwd, workspaceStore = null, logger = console }) {
    this.client = client;
    this.cwd = cwd;
    this.workspaceStore = workspaceStore;
    this.logger = logger;
    this.jobs = new Map();
    this.jobsByThread = new Map();
    this.jobsByTurn = new Map();
    this.pluginCache = { at: 0, items: [] };
    this.modelCache = { at: 0, items: [] };

    client.on("notification", (message) => this.#onNotification(message));
    client.on("serverRequest", (message) => this.#onServerRequest(message));
    client.on("exit", (error) => this.#onExit(error));
  }

  async listPlugins({ force = false } = {}) {
    if (!force && Date.now() - this.pluginCache.at < 10_000) {
      return this.pluginCache.items;
    }
    const response = await this.client.request("plugin/list", { cwds: [this.cwd] });
    const items = flattenPluginResponse(response);
    this.pluginCache = { at: Date.now(), items };
    return items;
  }

  async listModels({ force = false } = {}) {
    if (!force && Date.now() - this.modelCache.at < 30_000) {
      return this.modelCache.items;
    }

    const allItems = [];
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const response = await this.client.request("model/list", {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      });
      allItems.push(...(response.data || []));
      cursor = response.nextCursor || null;
      if (!cursor) break;
    }

    const items = normalizeModels(allItems);
    this.modelCache = { at: Date.now(), items };
    return items;
  }

  async startTurn({
    threadId,
    message,
    selection,
    selectionReference = null,
    selectionReferences = null,
    contextBefore,
    contextAfter,
    pluginIds = [],
    model = null,
    effort = null,
    history = [],
    files = [],
    workspaceId = null,
    project = null,
  }) {
    if (!message?.trim()) throw new Error("Message is required.");
    if (typeof selection !== "string") throw new Error("Selection must be a string.");
    if (!Array.isArray(files)) throw new Error("Attached files must be an array.");
    if (selectionReferences != null && !Array.isArray(selectionReferences)) {
      throw new Error("Selection references must be an array.");
    }
    const hasProject = Boolean(project?.synced && workspaceId);
    if (
      !selection.length &&
      !selectionReference &&
      !selectionReferences?.length &&
      !files.length &&
      !hasProject
    ) {
      throw new Error(
        "An Overleaf selection, file-range reference, attached file, or project is required.",
      );
    }
    const workspace = this.workspaceStore
      ? hasProject
        ? this.workspaceStore.openProject(workspaceId)
        : this.workspaceStore.sync(workspaceId || threadId || randomUUID(), files)
      : { id: workspaceId, directory: this.cwd, files: [], project: null };
    const mentionedFiles = hasProject
      ? resolveProjectMentions(workspace.files, files)
      : workspace.files;
    const returnedFiles = hasProject
      ? normalizeReturnedAttachments(files, mentionedFiles)
      : workspace.files;
    const requestedSelectionReferences = selectionReferences?.length
      ? selectionReferences
      : selectionReference
        ? [
            {
              ...selectionReference,
              text: selection,
              contextBefore,
              contextAfter,
            },
          ]
        : [];
    const resolvedSelectionReferences = resolveSelectionReferences(
      workspace.files,
      requestedSelectionReferences,
      this.logger,
    );
    const fileSelectionReferences = resolvedSelectionReferences.filter(
      (reference) => reference.path,
    );
    const contextFiles = mergeContextFiles(
      mentionedFiles,
      fileSelectionReferences,
    );

    const plugins = await this.listPlugins();
    const selectedPlugins = plugins.filter((plugin) => pluginIds.includes(plugin.id));
    const pluginDetails = await Promise.all(
      selectedPlugins.map((plugin) => this.#readPlugin(plugin).catch(() => null)),
    );

    let resolvedModel = typeof model === "string" && model.trim() ? model.trim() : null;
    let resolvedEffort = typeof effort === "string" && effort.trim() ? effort.trim() : null;
    if (resolvedModel || resolvedEffort) {
      const models = await this.listModels();
      const selectedModel = resolvedModel
        ? models.find((item) => item.model === resolvedModel || item.id === resolvedModel)
        : models.find((item) => item.isDefault) || models[0];
      if (!selectedModel) throw new Error(`Codex 模型不可用：${resolvedModel || "默认模型"}。`);
      if (
        resolvedEffort &&
        !selectedModel.supportedReasoningEfforts.some(
          (option) => option.reasoningEffort === resolvedEffort,
        )
      ) {
        throw new Error(
          `${selectedModel.displayName} 不支持推理强度 ${resolvedEffort}。`,
        );
      }
      resolvedModel = selectedModel.model;
      resolvedEffort = resolvedEffort || selectedModel.defaultReasoningEffort;
    }

    let activeThreadId = threadId;
    if (!activeThreadId) {
      const params = {
        cwd: workspace.directory,
        ephemeral: true,
        sandbox: "read-only",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        developerInstructions: DEVELOPER_INSTRUCTIONS,
        serviceName: "overleaf_codex",
      };
      if (resolvedModel) params.model = resolvedModel;
      const started = await this.client.request("thread/start", params);
      activeThreadId = started.thread.id;
    }

    if (this.jobsByThread.has(activeThreadId)) {
      const existing = this.jobs.get(this.jobsByThread.get(activeThreadId));
      if (existing && existing.status === "active") {
        throw new Error("This Codex conversation already has an active turn.");
      }
    }

    const job = {
      id: randomUUID(),
      threadId: activeThreadId,
      turnId: null,
      status: "starting",
      events: [],
      nextSequence: 1,
      pendingRequests: new Map(),
      agentMessages: [],
      agentDeltas: new Map(),
      messagePhases: new Map(),
      workspaceId: workspace.id,
      selectionReferences: resolvedSelectionReferences,
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.jobsByThread.set(activeThreadId, job.id);
    this.#push(job, "status", { label: "Codex 正在思考…" });

    const input = buildTurnInput({
      message: message.trim(),
      selection: requestedSelectionReferences.length ? "" : selection,
      selectionReference: null,
      selectionReferences: resolvedSelectionReferences,
      contextBefore,
      contextAfter,
      selectedPlugins,
      pluginDetails: pluginDetails.filter(Boolean),
      history,
      files: contextFiles,
      project: hasProject ? workspace.project : null,
    });

    try {
      const response = await this.client.request("turn/start", {
        threadId: activeThreadId,
        input,
        cwd: workspace.directory,
        outputSchema: RESULT_SCHEMA,
        summary: "auto",
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...(resolvedEffort ? { effort: resolvedEffort } : {}),
      });
      job.turnId = response.turn.id;
      job.status = "active";
      this.jobsByTurn.set(job.turnId, job.id);
      return {
        jobId: job.id,
        threadId: activeThreadId,
        turnId: job.turnId,
        model: resolvedModel,
        effort: resolvedEffort,
        workspaceId: workspace.id,
        project: hasProject
          ? {
              synced: true,
              workspaceId: workspace.id,
              ...workspace.project,
            }
          : null,
        files: returnedFiles.map((file) => ({
          id: file.id,
          name: file.name,
          relativePath: file.relativePath || null,
          length: file.length,
          sha256: file.sha256,
          editorIndex: file.editorIndex,
          capturedAt: file.capturedAt,
          changed: Boolean(file.changed),
        })),
        selectionReference: publicSelectionReference(
          resolvedSelectionReferences[0],
        ),
        selectionReferences: resolvedSelectionReferences.map(
          publicSelectionReference,
        ),
      };
    } catch (error) {
      job.status = "failed";
      this.#push(job, "error", { message: error.message });
      throw error;
    }
  }

  getJob(jobId, after = 0) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      id: job.id,
      threadId: job.threadId,
      turnId: job.turnId,
      status: job.status,
      events: job.events.filter((event) => event.sequence > after),
      nextSequence: job.nextSequence - 1,
    };
  }

  async respond(jobId, requestId, { action, content } = {}) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Unknown job.");
    const request = job.pendingRequests.get(String(requestId));
    if (!request) throw new Error("This approval request is no longer pending.");

    const approved = action === "approve";
    const cancelled = action === "cancel";
    let result;

    switch (request.method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        result = { decision: approved ? "accept" : cancelled ? "cancel" : "decline" };
        break;
      case "mcpServer/elicitation/request":
        result = {
          action: approved ? "accept" : cancelled ? "cancel" : "decline",
          ...(approved ? { content: content || {} } : {}),
        };
        break;
      case "item/tool/requestUserInput": {
        const answers = {};
        const supplied = content?.answers || {};
        for (const question of request.params.questions || []) {
          const value = supplied[question.id] ?? content?.text ?? "";
          answers[question.id] = {
            answers: Array.isArray(value) ? value.map(String) : value ? [String(value)] : [],
          };
        }
        result = { answers };
        if (!approved) {
          await this.interrupt(jobId).catch(() => {});
        }
        break;
      }
      case "item/permissions/requestApproval":
        result = {
          permissions: approved
            ? {
                fileSystem: request.params.permissions?.fileSystem || null,
                network: request.params.permissions?.network || null,
              }
            : { fileSystem: null, network: null },
          scope: "turn",
        };
        break;
      default:
        throw new Error(`Unsupported approval request: ${request.method}`);
    }

    this.client.respond(request.id, result);
    job.pendingRequests.delete(String(requestId));
    this.#push(job, "approval_resolved", {
      requestId: String(requestId),
      approved,
    });
    return { ok: true };
  }

  async interrupt(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Unknown job.");
    if (!job.turnId) return { ok: true };
    await this.client.request("turn/interrupt", {
      threadId: job.threadId,
      turnId: job.turnId,
    });
    return { ok: true };
  }

  async steer(jobId, message, selectionReferences = undefined) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Unknown job.");
    if (job.status !== "active" || !job.turnId) {
      throw new Error("This Codex turn is no longer active.");
    }
    if (typeof message !== "string" || !message.trim()) {
      throw new Error("Message is required.");
    }
    let resolvedSelectionReferences = job.selectionReferences || [];
    if (selectionReferences !== undefined) {
      const requested =
        selectionReferences == null
          ? []
          : Array.isArray(selectionReferences)
            ? selectionReferences
            : [selectionReferences];
      const workspace =
        this.workspaceStore && job.workspaceId
          ? this.workspaceStore.openProject(job.workspaceId)
          : null;
      resolvedSelectionReferences = resolveSelectionReferences(
        workspace?.files || [],
        requested,
        this.logger,
      );
      job.selectionReferences = resolvedSelectionReferences;
    }
    const input = buildSteerInput({
      message,
      selectionReferences: resolvedSelectionReferences,
      files: resolvedSelectionReferences.filter((reference) => reference.path),
    });
    const result = await this.client.request("turn/steer", {
      threadId: job.threadId,
      expectedTurnId: job.turnId,
      input,
    });
    this.#push(job, "steered", { message: message.trim() });
    return { ok: true, turnId: result.turnId || job.turnId };
  }

  async #readPlugin(plugin) {
    const params = {
      pluginName: plugin.name,
      marketplacePath: plugin.marketplacePath,
      remoteMarketplaceName: plugin.marketplacePath ? null : plugin.marketplaceName,
    };
    const response = await this.client.request("plugin/read", params);
    return response.plugin;
  }

  #findJob(params = {}) {
    const byTurn = params.turnId && this.jobsByTurn.get(params.turnId);
    const byThread = params.threadId && this.jobsByThread.get(params.threadId);
    return this.jobs.get(byTurn || byThread);
  }

  #onNotification(message) {
    const job = this.#findJob(message.params);
    if (!job) return;
    const { method, params } = message;

    if (method === "turn/started" && params.turn?.id) {
      job.turnId = params.turn.id;
      job.status = "active";
      this.jobsByTurn.set(job.turnId, job.id);
      return;
    }

    if (method === "item/started") {
      const item = params.item;
      if (item?.type === "agentMessage") {
        job.messagePhases.set(item.id, item.phase || null);
        if (item.phase === "commentary") {
          this.#push(job, "commentary_started", { itemId: item.id });
        }
      }
      if (item?.type === "reasoning") {
        this.#push(job, "reasoning_started", {
          itemId: item.id,
          summary: item.summary || [],
        });
      }
      if (["mcpToolCall", "dynamicToolCall", "commandExecution", "webSearch"].includes(item?.type)) {
        this.#push(job, "tool_started", summarizeToolItem(item));
      }
      return;
    }

    if (method === "item/completed") {
      const item = params.item;
      if (item?.type === "agentMessage" && item.text) {
        job.agentMessages.push(item.text);
        if (
          item.phase === "commentary" ||
          job.messagePhases.get(item.id) === "commentary"
        ) {
          this.#push(job, "commentary_completed", {
            itemId: item.id,
            text: item.text,
          });
        }
      }
      if (item?.type === "reasoning") {
        this.#push(job, "reasoning_completed", {
          itemId: item.id,
          summary: item.summary || [],
        });
      }
      if (["mcpToolCall", "dynamicToolCall", "commandExecution", "webSearch"].includes(item?.type)) {
        this.#push(job, "tool_completed", summarizeToolItem(item));
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      const current = job.agentDeltas.get(params.itemId) || "";
      job.agentDeltas.set(params.itemId, current + (params.delta || ""));
      if (job.messagePhases.get(params.itemId) === "commentary") {
        this.#push(job, "commentary_delta", {
          itemId: params.itemId,
          delta: params.delta || "",
        });
      }
      return;
    }

    if (method === "item/reasoning/summaryPartAdded") {
      this.#push(job, "reasoning_part", {
        itemId: params.itemId,
        summaryIndex: params.summaryIndex,
      });
      return;
    }

    if (method === "item/reasoning/summaryTextDelta") {
      this.#push(job, "reasoning_delta", {
        itemId: params.itemId,
        summaryIndex: params.summaryIndex,
        delta: params.delta || "",
      });
      return;
    }

    if (method === "item/mcpToolCall/progress") {
      this.#push(job, "tool_progress", {
        itemId: params.itemId,
        message: params.message || "插件正在处理…",
      });
      return;
    }

    if (method === "turn/completed") {
      const turn = params.turn;
      job.status = turn.status === "completed" ? "completed" : turn.status;
      const agentMessages = (turn.items || []).filter((item) => item.type === "agentMessage");
      const finalText =
        agentMessages
          .map((item) => item.text)
          .filter(Boolean)
          .at(-1) ||
        job.agentMessages.filter(Boolean).at(-1) ||
        Array.from(job.agentDeltas.values()).filter(Boolean).at(-1) ||
        "";
      if (turn.status === "completed") {
        this.#push(job, "result", parseStructuredResult(finalText));
      } else {
        this.#push(job, "error", {
          message: turn.error?.message || `Codex turn ended with status: ${turn.status}`,
        });
      }
      return;
    }

    if (method === "error") {
      this.#push(job, "error", {
        message: params.error?.message || params.message || "Codex returned an error.",
      });
      return;
    }

    if (["warning", "guardianWarning", "configWarning"].includes(method)) {
      this.#push(job, "warning", {
        message: params.message || params.warning || method,
      });
    }
  }

  #onServerRequest(request) {
    const job = this.#findJob(request.params);
    if (!job) {
      this.#declineUnroutableRequest(request);
      return;
    }
    const requestId = String(request.id);
    job.pendingRequests.set(requestId, request);
    this.#push(job, "approval", {
      requestId,
      method: request.method,
      ...formatApproval(request),
    });
  }

  #declineUnroutableRequest(request) {
    if (
      request.method === "item/commandExecution/requestApproval" ||
      request.method === "item/fileChange/requestApproval"
    ) {
      this.client.respond(request.id, { decision: "decline" });
    } else if (request.method === "mcpServer/elicitation/request") {
      this.client.respond(request.id, { action: "decline" });
    } else if (request.method === "item/tool/requestUserInput") {
      this.client.respond(request.id, { answers: {} });
    } else if (request.method === "item/permissions/requestApproval") {
      this.client.respond(request.id, {
        permissions: { fileSystem: null, network: null },
        scope: "turn",
      });
    } else {
      this.client.respondError(request.id, -32601, "Unsupported client request.");
    }
  }

  #onExit(error) {
    for (const job of this.jobs.values()) {
      if (job.status === "active" || job.status === "starting") {
        job.status = "failed";
        this.#push(job, "error", { message: error.message });
      }
    }
  }

  #push(job, type, data) {
    job.events.push({
      sequence: job.nextSequence++,
      type,
      data,
      at: Date.now(),
    });
    if (job.events.length > EVENT_LIMIT) {
      job.events.splice(0, job.events.length - EVENT_LIMIT);
    }
  }
}

function resolveSelectionReferences(projectFiles, references, logger = console) {
  if (!Array.isArray(references)) {
    throw new Error("Selection references must be an array.");
  }
  return references.map((reference, index) => {
    try {
      return resolveSelectionReference(projectFiles, reference);
    } catch (error) {
      const text =
        typeof reference?.text === "string"
          ? reference.text.slice(0, 20_000)
          : "";
      if (!text) throw error;
      logger.warn?.(
        `Falling back to raw selection ${index + 1} because the mirrored file reference could not be resolved: ${error.message}`,
      );
      return {
        text,
        contextBefore:
          typeof reference.contextBefore === "string"
            ? reference.contextBefore.slice(-1_200)
            : "",
        contextAfter:
          typeof reference.contextAfter === "string"
            ? reference.contextAfter.slice(0, 1_200)
            : "",
      };
    }
  });
}

function resolveSelectionReference(projectFiles, reference) {
  if (!reference || typeof reference !== "object") {
    throw new Error("Selection reference must be an object.");
  }
  const requestedPath = String(
    reference.relativePath || reference.name || "",
  )
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  const startLine = Number(reference.startLine);
  const endLine = Number(reference.endLine);
  if (
    !requestedPath ||
    requestedPath.split("/").includes("..") ||
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  ) {
    throw new Error("Selection reference requires a file path and valid line range.");
  }
  const exact = projectFiles.filter(
    (file) =>
      file.relativePath === requestedPath ||
      file.id === requestedPath,
  );
  const basename = projectFiles.filter(
    (file) => pathBasename(file.relativePath || file.name) === pathBasename(requestedPath),
  );
  const match =
    exact.length === 1
      ? exact[0]
      : exact.length === 0 && basename.length === 1
        ? basename[0]
        : null;
  if (!match) {
    throw new Error(
      exact.length > 1 || basename.length > 1
        ? `选区文件路径不明确：${requestedPath}`
        : `同步项目中找不到选区文件：${requestedPath}`,
    );
  }
  return {
    ...match,
    name: match.relativePath || match.name || requestedPath,
    relativePath: match.relativePath || requestedPath,
    startLine,
    endLine,
  };
}

function mergeContextFiles(...groups) {
  const merged = [];
  const seen = new Set();
  for (const file of groups.flat()) {
    if (!file?.path) continue;
    const key = file.relativePath || file.path;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  return merged;
}

function publicSelectionReference(reference) {
  if (!reference) return null;
  if (!reference.path) {
    return {
      type: "text",
      length: reference.text?.length || 0,
    };
  }
  return {
    name: reference.name,
    relativePath: reference.relativePath,
    startLine: reference.startLine,
    endLine: reference.endLine,
  };
}

function resolveProjectMentions(projectFiles, attachments) {
  const resolved = [];
  const seen = new Set();
  for (const attachment of attachments) {
    const name = String(attachment?.name || "").trim().replaceAll("\\", "/");
    if (!name) continue;
    const exact = projectFiles.filter(
      (file) =>
        file.relativePath === name ||
        file.id === attachment.id ||
        file.relativePath === attachment.relativePath,
    );
    const basename = projectFiles.filter(
      (file) => pathBasename(file.relativePath) === pathBasename(name),
    );
    const match = exact.length === 1 ? exact[0] : basename.length === 1 ? basename[0] : null;
    if (!match || seen.has(match.relativePath)) continue;
    seen.add(match.relativePath);
    resolved.push(match);
  }
  return resolved;
}

function normalizeReturnedAttachments(attachments, mentionedFiles) {
  return attachments.map((attachment, index) => {
    const name =
      typeof attachment?.name === "string" && attachment.name.trim()
        ? attachment.name.trim().slice(0, 500)
        : `attached-file-${index + 1}`;
    const matched = mentionedFiles.find(
      (file) =>
        file.relativePath === name ||
        pathBasename(file.relativePath) === pathBasename(name),
    );
    return {
      id:
        typeof attachment?.id === "string" && attachment.id
          ? attachment.id.slice(0, 300)
          : `${Number.isInteger(attachment?.editorIndex) ? attachment.editorIndex : 0}:${name}`,
      name,
      relativePath:
        matched?.relativePath ||
        (typeof attachment?.relativePath === "string"
          ? attachment.relativePath.slice(0, 1_000)
          : null),
      length: matched?.length ?? attachment?.length ?? 0,
      sha256: matched?.sha256 ?? attachment?.sha256 ?? null,
      editorIndex: Number.isInteger(attachment?.editorIndex)
        ? attachment.editorIndex
        : 0,
      capturedAt: Number.isFinite(attachment?.capturedAt)
        ? attachment.capturedAt
        : Date.now(),
      changed: false,
    };
  });
}

function pathBasename(value) {
  return String(value || "").split("/").at(-1) || "";
}

function formatApproval(request) {
  const params = request.params || {};
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return {
        title: "Codex 请求运行命令",
        description: params.reason || params.command || "插件需要运行一个本机命令。",
        command: params.command || null,
      };
    case "item/fileChange/requestApproval":
      return {
        title: "Codex 请求修改本机文件",
        description: params.reason || "此操作不属于 Overleaf 文本写回，建议拒绝。",
      };
    case "item/permissions/requestApproval":
      return {
        title: "Codex 请求额外权限",
        description: params.reason || "插件请求额外的文件或网络权限。",
        permissions: params.permissions || null,
      };
    case "mcpServer/elicitation/request":
      return {
        title: `插件 ${params.serverName || ""} 需要确认`,
        description: params.message || "插件需要你的输入或授权。",
        mode: params.mode || null,
        url: params.url || null,
        schema: params.requestedSchema || null,
      };
    case "item/tool/requestUserInput":
      return {
        title: "Codex 需要你的输入",
        description: params.questions?.[0]?.question || "请提供继续执行所需的信息。",
        questions: params.questions || [],
      };
    default:
      return {
        title: "Codex 请求确认",
        description: request.method,
      };
  }
}
