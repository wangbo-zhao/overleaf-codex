import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HISTORY_FILE_NAME = "overleaf-codex-history.json";
const CONFIG_FILE_NAME = "history-config.json";

export class HistoryStore {
  constructor({
    stateDirectory,
    codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  }) {
    this.stateDirectory = stateDirectory;
    this.defaultDirectory = path.join(codexHome, "sessions", "overleaf-codex");
    this.configPath = path.join(stateDirectory, CONFIG_FILE_NAME);
    this.directory = this.#readConfiguredDirectory();
  }

  getConfig() {
    return {
      directory: this.directory,
      defaultDirectory: this.defaultDirectory,
      filePath: path.join(this.directory, HISTORY_FILE_NAME),
      isDefault: this.directory === this.defaultDirectory,
    };
  }

  list() {
    const filePath = path.join(this.directory, HISTORY_FILE_NAME);
    if (!fs.existsSync(filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.conversations)
          ? parsed.conversations
          : [];
      return normalizeHistory(items);
    } catch (error) {
      throw new Error(`无法读取历史文件：${error.message}`);
    }
  }

  save(conversation) {
    const normalized = normalizeConversation(conversation);
    if (!normalized) throw new Error("Invalid conversation.");
    const next = [
      normalized,
      ...this.list().filter((item) => item.id !== normalized.id),
    ].sort((left, right) => right.updatedAt - left.updatedAt);
    this.#write(next);
    return next;
  }

  delete(id) {
    const next = this.list().filter((item) => item.id !== id);
    this.#write(next);
    return next;
  }

  import(conversations) {
    const incoming = normalizeHistory(conversations);
    const byId = new Map(this.list().map((item) => [item.id, item]));
    for (const item of incoming) {
      const existing = byId.get(item.id);
      if (!existing || item.updatedAt >= existing.updatedAt) byId.set(item.id, item);
    }
    const next = Array.from(byId.values())
      .sort((left, right) => right.updatedAt - left.updatedAt);
    if (next.length) this.#write(next);
    return next;
  }

  setDirectory(value) {
    const currentHistory = this.list();
    const nextDirectory = resolveDirectory(value, this.defaultDirectory);
    this.directory = nextDirectory;
    fs.mkdirSync(this.stateDirectory, { recursive: true, mode: 0o700 });
    atomicWriteJson(this.configPath, {
      version: 1,
      directory:
        nextDirectory === this.defaultDirectory ? "" : nextDirectory,
    });
    if (currentHistory.length) this.import(currentHistory);
    return this.getConfig();
  }

  #readConfiguredDirectory() {
    if (!fs.existsSync(this.configPath)) return this.defaultDirectory;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      return resolveDirectory(parsed?.directory, this.defaultDirectory);
    } catch {
      return this.defaultDirectory;
    }
  }

  #write(conversations) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    atomicWriteJson(path.join(this.directory, HISTORY_FILE_NAME), {
      version: 1,
      conversations,
    });
  }
}

function resolveDirectory(value, defaultDirectory) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return defaultDirectory;
  const expanded =
    raw === "~"
      ? os.homedir()
      : raw.startsWith("~/")
        ? path.join(os.homedir(), raw.slice(2))
        : raw;
  if (!path.isAbsolute(expanded)) {
    throw new Error("历史目录必须是绝对路径，或以 ~/ 开头。");
  }
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) {
    throw new Error("不能把磁盘根目录用作历史目录。");
  }
  return resolved;
}

function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${randomBytes(8).toString("hex")}`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temporary, filePath);
}

function normalizeHistory(values) {
  return (Array.isArray(values) ? values : [])
    .map(normalizeConversation)
    .filter(Boolean)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function normalizeConversation(value) {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  const messages = (Array.isArray(value.messages) ? value.messages : [])
    .filter(
      (message) =>
        ["user", "assistant"].includes(message?.role) &&
        typeof message.text === "string" &&
        message.text,
    )
    .slice(-100)
    .map((message) => {
      const references = normalizeMessageReferences(message.references);
      const files = normalizeMessageFiles(message.files);
      return {
        role: message.role,
        text: message.text.slice(0, 40_000),
        at: Number.isFinite(message.at) ? message.at : Date.now(),
        ...(references.length ? { references } : {}),
        ...(files.length ? { files } : {}),
      };
    });
  return {
    id: value.id.slice(0, 100),
    title:
      typeof value.title === "string" && value.title.trim()
        ? value.title.trim().slice(0, 80)
        : "新对话",
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    threadId: typeof value.threadId === "string" ? value.threadId.slice(0, 200) : null,
    workspaceId:
      typeof value.workspaceId === "string" ? value.workspaceId.slice(0, 200) : value.id.slice(0, 100),
    model: typeof value.model === "string" ? value.model.slice(0, 100) : null,
    effort: typeof value.effort === "string" ? value.effort.slice(0, 40) : null,
    project: normalizeProject(value.project),
    snapshot: normalizeSnapshot(value.snapshot),
    selectionReferences: normalizeSelectionReferences(
      value.selectionReferences,
    ),
    files: normalizeFiles(value.files),
    messages,
  };
}

function normalizeMessageReferences(values) {
  return (Array.isArray(values) ? values : [])
    .filter((reference) => reference && typeof reference === "object")
    .slice(0, 50)
    .map((reference, index) => {
      const relativePath =
        typeof reference.relativePath === "string" &&
        reference.relativePath.trim()
          ? reference.relativePath
              .trim()
              .replaceAll("\\", "/")
              .replace(/^\/+/, "")
              .slice(0, 1_000)
          : null;
      return {
        id:
          typeof reference.id === "string" && reference.id
            ? reference.id.slice(0, 200)
            : `message-reference-${index + 1}`,
        name:
          typeof reference.name === "string" && reference.name.trim()
            ? reference.name.trim().replace(/[\r\n\t]/g, " ").slice(0, 500)
            : relativePath?.split("/").at(-1) || `Overleaf 引用 ${index + 1}`,
        relativePath,
        startLine:
          Number.isInteger(reference.startLine) && reference.startLine >= 1
            ? reference.startLine
            : null,
        endLine:
          Number.isInteger(reference.endLine) && reference.endLine >= 1
            ? reference.endLine
            : null,
      };
    });
}

function normalizeMessageFiles(values) {
  return (Array.isArray(values) ? values : [])
    .filter((file) => file && typeof file === "object")
    .slice(0, 50)
    .map((file, index) => {
      const relativePath =
        typeof file.relativePath === "string" && file.relativePath.trim()
          ? file.relativePath
              .trim()
              .replaceAll("\\", "/")
              .replace(/^\/+/, "")
              .slice(0, 1_000)
          : null;
      return {
        id:
          typeof file.id === "string" && file.id
            ? file.id.slice(0, 300)
            : `message-file-${index + 1}`,
        name:
          typeof file.name === "string" && file.name.trim()
            ? file.name.trim().replace(/[\r\n\t]/g, " ").slice(0, 500)
            : relativePath?.split("/").at(-1) || `Overleaf 文件 ${index + 1}`,
        relativePath,
      };
    });
}

function normalizeProject(value) {
  if (!value || typeof value !== "object") return null;
  const projectId =
    typeof value.projectId === "string" && value.projectId.trim()
      ? value.projectId.trim().slice(0, 200)
      : null;
  const origin =
    typeof value.origin === "string" && value.origin.trim()
      ? value.origin.trim().slice(0, 500)
      : null;
  const workspaceId =
    typeof value.workspaceId === "string" && value.workspaceId.trim()
      ? value.workspaceId.trim().slice(0, 1_000)
      : projectId && origin
        ? `${origin}|${projectId}`
        : null;
  if (!projectId && !workspaceId) return null;
  return {
    projectId,
    projectName:
      typeof value.projectName === "string" && value.projectName.trim()
        ? value.projectName.trim().slice(0, 500)
        : projectId || "Overleaf project",
    origin,
    workspaceId,
  };
}

function normalizeFiles(values) {
  return (Array.isArray(values) ? values : [])
    .filter((file) => file && typeof file.name === "string")
    .map((file, index) => {
      const name =
        typeof file.name === "string" && file.name.trim()
          ? file.name.trim().replace(/[\r\n\t]/g, " ").slice(0, 200)
          : `attached-file-${index + 1}`;
      const editorIndex = Number.isInteger(file.editorIndex) ? file.editorIndex : 0;
      return {
        id:
          typeof file.id === "string" && file.id
            ? file.id.slice(0, 300)
            : `${editorIndex}:${name}`,
        name,
        relativePath:
          typeof file.relativePath === "string" && file.relativePath.trim()
            ? file.relativePath
                .trim()
                .replaceAll("\\", "/")
                .replace(/^\/+/, "")
                .slice(0, 1_000)
            : null,
        length: Number.isFinite(file.length)
          ? file.length
          : typeof file.content === "string"
            ? file.content.length
            : 0,
        sha256:
          typeof file.sha256 === "string" && /^[a-f0-9]{64}$/i.test(file.sha256)
            ? file.sha256.toLowerCase()
            : null,
        editorIndex,
        capturedAt: Number.isFinite(file.capturedAt) ? file.capturedAt : Date.now(),
      };
    });
}

function normalizeSnapshot(value) {
  if (!value || typeof value.text !== "string") return null;
  return {
    text: value.text.slice(0, 20_000),
    from: Number.isInteger(value.from) ? value.from : 0,
    to: Number.isInteger(value.to) ? value.to : value.text.length,
    documentLength: Number.isInteger(value.documentLength)
      ? value.documentLength
      : value.text.length,
    contextBefore:
      typeof value.contextBefore === "string" ? value.contextBefore.slice(-1200) : "",
    contextAfter:
      typeof value.contextAfter === "string" ? value.contextAfter.slice(0, 1200) : "",
    anchorBefore:
      typeof value.anchorBefore === "string" ? value.anchorBefore.slice(-80) : "",
    anchorAfter:
      typeof value.anchorAfter === "string" ? value.anchorAfter.slice(0, 80) : "",
    editorIndex: Number.isInteger(value.editorIndex) ? value.editorIndex : 0,
    filePath:
      typeof value.filePath === "string" && value.filePath.trim()
        ? value.filePath
            .trim()
            .replaceAll("\\", "/")
            .replace(/^\/+/, "")
            .slice(0, 1_000)
        : null,
    fileName:
      typeof value.fileName === "string" && value.fileName.trim()
        ? value.fileName.trim().replace(/[\r\n\t]/g, " ").slice(0, 500)
        : null,
    lineStart: Number.isInteger(value.lineStart) ? value.lineStart : null,
    lineEnd: Number.isInteger(value.lineEnd) ? value.lineEnd : null,
    lineText:
      typeof value.lineText === "string"
        ? value.lineText.slice(0, 20_000)
        : "",
    emptySelection: Boolean(value.emptySelection),
    viewAvailable: Boolean(value.viewAvailable),
    rect: value.rect && typeof value.rect === "object" ? value.rect : null,
  };
}

function normalizeSelectionReferences(values) {
  const references = [];
  const seen = new Set();
  for (const [index, value] of (
    Array.isArray(values) ? values : []
  ).entries()) {
    const snapshot = normalizeSnapshot(value?.snapshot || value);
    if (!snapshot) continue;
    const key =
      snapshot.filePath &&
      Number.isInteger(snapshot.lineStart) &&
      Number.isInteger(snapshot.lineEnd)
        ? `${snapshot.filePath}:${snapshot.lineStart}:${snapshot.lineEnd}`
        : [
            `editor-${snapshot.editorIndex}`,
            snapshot.from,
            snapshot.to,
            snapshot.text,
          ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({
      id:
        typeof value?.id === "string" && value.id
          ? value.id.slice(0, 200)
          : `reference-${index + 1}`,
      snapshot,
    });
  }
  return references;
}
