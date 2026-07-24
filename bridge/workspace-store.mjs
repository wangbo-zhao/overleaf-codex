import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";

const MANIFEST_FILE = ".overleaf-codex-files.json";
const PROJECT_DIRECTORY = "project";
const PROJECT_MANIFEST_FILE = ".overleaf-codex-project.json";
const PROJECT_STAGING_DIRECTORY = ".overleaf-codex-staging";
const WORKSPACE_CONFIG_FILE = "workspace-config.json";
const MAX_UNCOMPRESSED_PROJECT_BYTES = 1_000_000_000;

export class WorkspaceStore {
  constructor({ rootDirectory, stateDirectory = path.dirname(rootDirectory) }) {
    this.defaultDirectory = path.resolve(rootDirectory);
    this.stateDirectory = path.resolve(stateDirectory);
    this.configPath = path.join(this.stateDirectory, WORKSPACE_CONFIG_FILE);
    this.rootDirectory = this.#readConfiguredDirectory();
    fs.mkdirSync(this.rootDirectory, { recursive: true, mode: 0o700 });
  }

  getConfig() {
    return {
      directory: this.rootDirectory,
      defaultDirectory: this.defaultDirectory,
      isDefault: this.rootDirectory === this.defaultDirectory,
    };
  }

  setDirectory(value) {
    const nextDirectory = resolveWorkspaceDirectory(
      value,
      this.defaultDirectory,
    );
    const previousDirectory = this.rootDirectory;
    if (nextDirectory !== previousDirectory) {
      assertDirectoriesAreIndependent(previousDirectory, nextDirectory);
      migrateWorkspaceDirectory(previousDirectory, nextDirectory);
      this.rootDirectory = nextDirectory;
    }

    fs.mkdirSync(this.stateDirectory, { recursive: true, mode: 0o700 });
    atomicWriteJson(this.configPath, {
      version: 1,
      directory:
        this.rootDirectory === this.defaultDirectory ? "" : this.rootDirectory,
    });
    return {
      ...this.getConfig(),
      migratedFrom:
        nextDirectory === previousDirectory ? null : previousDirectory,
    };
  }

  sync(workspaceId, values = []) {
    if (!Array.isArray(values)) throw new Error("Attached files must be an array.");
    const id = normalizeWorkspaceId(workspaceId);
    const directory = path.join(this.rootDirectory, id);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    const previous = readManifest(directory);
    const previousById = new Map(previous.map((file) => [file.id, file]));
    const files = values.map((value, index) =>
      this.#syncFile(directory, value, index, previousById),
    );
    const retainedPaths = new Set(files.map((file) => file.relativePath));

    for (const file of previous) {
      if (retainedPaths.has(file.relativePath)) continue;
      const target = resolveInside(directory, file.relativePath);
      if (fs.existsSync(target) && fs.lstatSync(target).isFile()) fs.unlinkSync(target);
    }

    atomicWriteJson(path.join(directory, MANIFEST_FILE), {
      version: 1,
      workspaceId: id,
      files: files.map(publicFile),
    });
    return {
      id,
      directory,
      files,
    };
  }

  syncProject(workspaceId, archive, metadata = {}) {
    if (!Buffer.isBuffer(archive) && !(archive instanceof Uint8Array)) {
      throw new Error("Overleaf project archive is invalid.");
    }
    const rawWorkspaceId = normalizeRawWorkspaceId(workspaceId);
    const id = normalizeWorkspaceId(rawWorkspaceId);
    const container = path.join(this.rootDirectory, id);
    const directory = path.join(container, PROJECT_DIRECTORY);
    const manifestPath = path.join(container, PROJECT_MANIFEST_FILE);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    let unpacked;
    try {
      unpacked = unzipSync(new Uint8Array(archive));
    } catch (error) {
      throw new Error(`无法解压 Overleaf 项目：${error.message}`);
    }

    const previousManifest = readProjectManifest(manifestPath);
    const previousByPath = new Map(
      previousManifest.files.map((file) => [file.relativePath, file]),
    );
    const seen = new Set();
    const files = [];
    let changedCount = 0;
    let totalBytes = 0;

    for (const [archivePath, bytes] of Object.entries(unpacked)) {
      if (archivePath.endsWith("/")) continue;
      const relativePath = normalizeProjectPath(archivePath);
      if (seen.has(relativePath)) {
        throw new Error(`Overleaf 项目包含重复路径：${relativePath}`);
      }
      seen.add(relativePath);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_UNCOMPRESSED_PROJECT_BYTES) {
        throw new Error("Overleaf 项目解压后过大，已停止同步以保护本机内存。");
      }

      const target = resolveInside(directory, relativePath);
      const content = Buffer.from(bytes);
      const sha256 = createHash("sha256").update(content).digest("hex");
      const previous = previousByPath.get(relativePath);
      const changed =
        !previous || previous.sha256 !== sha256 || !isRegularFile(target);
      if (changed) {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        atomicWriteBuffer(target, content);
        changedCount += 1;
      }
      const fileStat = fs.statSync(target);
      files.push({
        id: relativePath,
        name: path.basename(relativePath),
        relativePath,
        path: target,
        length: content.byteLength,
        sha256,
        mtimeMs: fileStat.mtimeMs,
        changed,
      });
    }

    let deletedCount = 0;
    for (const previous of previousManifest.files) {
      if (seen.has(previous.relativePath)) continue;
      deletedCount += 1;
    }
    pruneUntrackedProjectPaths(directory, seen);

    const syncedAt = Date.now();
    const project = {
      projectId:
        typeof metadata.projectId === "string"
          ? metadata.projectId.slice(0, 200)
          : null,
      projectName:
        typeof metadata.projectName === "string" && metadata.projectName.trim()
          ? metadata.projectName.trim().slice(0, 500)
          : "Overleaf project",
      origin:
        typeof metadata.origin === "string" ? metadata.origin.slice(0, 500) : null,
      historyVersion:
        typeof metadata.historyVersion === "string"
          ? metadata.historyVersion.slice(0, 200)
          : null,
      syncedAt,
      fileCount: files.length,
      totalBytes,
    };
    atomicWriteJson(manifestPath, {
      version: 1,
      workspaceId: rawWorkspaceId,
      project,
      files: files.map(publicFile),
    });

    return {
      id: rawWorkspaceId,
      storageId: id,
      directory,
      files,
      project,
      changedCount,
      deletedCount,
    };
  }

  getProjectState(workspaceId) {
    const rawWorkspaceId = normalizeRawWorkspaceId(workspaceId);
    const id = normalizeWorkspaceId(rawWorkspaceId);
    const container = path.join(this.rootDirectory, id);
    const manifest = readProjectManifest(
      path.join(container, PROJECT_MANIFEST_FILE),
    );
    return {
      exists: Boolean(manifest.project),
      workspaceId: rawWorkspaceId,
      project: manifest.project,
      fileCount: manifest.files.length,
    };
  }

  stageProjectBlob(workspaceId, hash, content) {
    const rawWorkspaceId = normalizeRawWorkspaceId(workspaceId);
    const id = normalizeWorkspaceId(rawWorkspaceId);
    const normalizedHash = normalizeBlobHash(hash);
    if (!Buffer.isBuffer(content) && !(content instanceof Uint8Array)) {
      throw new Error("Overleaf 变化文件内容无效。");
    }
    const value = Buffer.from(content);
    const actualHash = createHash("sha1").update(value).digest("hex");
    if (actualHash !== normalizedHash) {
      throw new Error(`Overleaf 变化文件校验失败：${normalizedHash}`);
    }

    const stagingDirectory = path.join(
      this.rootDirectory,
      id,
      PROJECT_STAGING_DIRECTORY,
    );
    fs.mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });
    const target = path.join(stagingDirectory, normalizedHash);
    const stagedMatches =
      isRegularFile(target) &&
      createHash("sha1").update(fs.readFileSync(target)).digest("hex") ===
        normalizedHash;
    if (!stagedMatches) {
      atomicWriteBuffer(target, value);
    }
    return {
      workspaceId: rawWorkspaceId,
      hash: normalizedHash,
      length: value.byteLength,
    };
  }

  syncProjectChanges(workspaceId, payload = {}, metadata = {}) {
    const rawWorkspaceId = normalizeRawWorkspaceId(workspaceId);
    const id = normalizeWorkspaceId(rawWorkspaceId);
    const container = path.join(this.rootDirectory, id);
    const directory = path.join(container, PROJECT_DIRECTORY);
    const manifestPath = path.join(container, PROJECT_MANIFEST_FILE);
    const previousManifest = readProjectManifest(manifestPath);
    if (!previousManifest.project) {
      throw new Error("Overleaf 项目镜像尚未初始化。");
    }

    const fromVersion = normalizeHistoryVersion(
      payload.fromVersion,
      "起始",
    );
    const toVersion = normalizeHistoryVersion(payload.toVersion, "目标");
    const previousVersion = normalizeHistoryVersion(
      previousManifest.project.historyVersion,
      "本地",
    );
    if (previousVersion !== fromVersion) {
      throw new Error(
        `Overleaf 增量版本不连续：本地 ${previousVersion}，请求 ${fromVersion}。`,
      );
    }
    if (toVersion < fromVersion) {
      throw new Error("Overleaf 目标版本不能早于本地版本。");
    }
    const changes = Array.isArray(payload.changes) ? payload.changes : null;
    if (!changes) {
      throw new Error("Overleaf 增量记录必须是数组。");
    }
    if (toVersion - fromVersion !== changes.length) {
      throw new Error(
        `Overleaf 增量记录数量与版本区间不一致：${changes.length} 条，${fromVersion}→${toVersion}。`,
      );
    }

    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const previousByPath = new Map(
      previousManifest.files.map((file) => [file.relativePath, file]),
    );
    const stagedByPath = new Map(
      previousManifest.files.map((file) => [
        file.relativePath,
        {
          ...file,
          relativePath: file.relativePath,
          content: null,
          dirty: false,
        },
      ]),
    );
    const usedBlobHashes = new Set();

    for (const [changeIndex, change] of changes.entries()) {
      if (!change || !Array.isArray(change.operations)) {
        throw new Error(`Overleaf 第 ${changeIndex + 1} 条增量记录无效。`);
      }
      for (const operation of change.operations) {
        applyRawProjectOperation({
          operation,
          stagedByPath,
          directory,
          container,
          usedBlobHashes,
        });
      }
    }

    const files = [];
    const retainedPaths = new Set();
    let changedCount = 0;
    let totalBytes = 0;
    for (const relativePath of [...stagedByPath.keys()].sort()) {
      const staged = stagedByPath.get(relativePath);
      const target = resolveInside(directory, relativePath);
      const previous = previousByPath.get(relativePath);
      let content = staged.content;
      let length;
      let sha256;
      let changed;
      const existingStat = isRegularFile(target) ? fs.statSync(target) : null;
      if (content === null && previous && existingStat) {
        length = existingStat.size;
        const manifestStillMatches =
          Number.isFinite(previous.length) &&
          previous.length === existingStat.size &&
          Number.isFinite(previous.mtimeMs) &&
          Math.abs(previous.mtimeMs - existingStat.mtimeMs) < 1;
        if (manifestStillMatches) {
          sha256 = previous.sha256;
        } else {
          content = fs.readFileSync(target);
          sha256 = createHash("sha256").update(content).digest("hex");
          if (sha256 !== previous.sha256) {
            throw new Error(
              `本地 Overleaf 镜像已被外部修改，无法安全应用增量：${relativePath}`,
            );
          }
        }
        changed = false;
      } else {
        content ??= fs.readFileSync(target);
        length = content.byteLength;
        sha256 = createHash("sha256").update(content).digest("hex");
        changed =
          !previous || previous.sha256 !== sha256 || !isRegularFile(target);
      }
      if (changed) {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        atomicWriteBuffer(target, content);
        changedCount += 1;
      }
      const fileStat = fs.statSync(target);
      totalBytes += length;
      if (totalBytes > MAX_UNCOMPRESSED_PROJECT_BYTES) {
        throw new Error("Overleaf 项目过大，已停止增量同步以保护本机内存。");
      }
      retainedPaths.add(relativePath);
      files.push({
        id: relativePath,
        name: path.basename(relativePath),
        relativePath,
        path: target,
        length,
        sha256,
        mtimeMs: fileStat.mtimeMs,
        changed,
      });
    }

    let deletedCount = 0;
    for (const previous of previousManifest.files) {
      if (!retainedPaths.has(previous.relativePath)) deletedCount += 1;
    }
    pruneUntrackedProjectPaths(directory, retainedPaths);

    const project = {
      ...previousManifest.project,
      projectId:
        typeof metadata.projectId === "string"
          ? metadata.projectId.slice(0, 200)
          : previousManifest.project.projectId,
      projectName:
        typeof payload.projectName === "string" && payload.projectName.trim()
          ? payload.projectName.trim().slice(0, 500)
          : previousManifest.project.projectName,
      origin:
        typeof metadata.origin === "string"
          ? metadata.origin.slice(0, 500)
          : previousManifest.project.origin,
      historyVersion: String(toVersion),
      syncedAt: Date.now(),
      fileCount: files.length,
      totalBytes,
    };
    atomicWriteJson(manifestPath, {
      version: 2,
      workspaceId: rawWorkspaceId,
      project,
      files: files.map(publicFile),
    });
    removeStagedProjectBlobs(container, usedBlobHashes);

    return {
      id: rawWorkspaceId,
      storageId: id,
      directory,
      files,
      project,
      changedCount,
      deletedCount,
    };
  }

  openProject(workspaceId) {
    const rawWorkspaceId = normalizeRawWorkspaceId(workspaceId);
    const id = normalizeWorkspaceId(rawWorkspaceId);
    const container = path.join(this.rootDirectory, id);
    const directory = path.join(container, PROJECT_DIRECTORY);
    const manifest = readProjectManifest(
      path.join(container, PROJECT_MANIFEST_FILE),
    );
    if (!manifest.files.length && !manifest.project) {
      throw new Error("Overleaf 项目镜像不存在，请重新同步。");
    }
    const files = manifest.files.map((file) => {
      const target = resolveInside(directory, file.relativePath);
      if (!isRegularFile(target)) {
        throw new Error(`Overleaf 项目镜像缺少文件：${file.relativePath}`);
      }
      return { ...file, path: target, changed: false };
    });
    return {
      id: rawWorkspaceId,
      storageId: id,
      directory,
      files,
      project: manifest.project,
      changedCount: 0,
      deletedCount: 0,
    };
  }

  #syncFile(directory, value, index, previousById) {
    if (!value || typeof value !== "object") {
      throw new Error(`Attached file ${index + 1} is invalid.`);
    }
    const name = normalizeDisplayName(value.name, index);
    const id =
      typeof value.id === "string" && value.id
        ? value.id.slice(0, 300)
        : `${Number.isInteger(value.editorIndex) ? value.editorIndex : 0}:${name}`;
    const previous = previousById.get(id);

    if (typeof value.content !== "string") {
      if (!previous) {
        throw new Error(`文件上下文 ${name} 已不存在，请在 Overleaf 中重新添加。`);
      }
      const target = resolveInside(directory, previous.relativePath);
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) {
        throw new Error(`文件上下文 ${name} 已不存在，请在 Overleaf 中重新添加。`);
      }
      return {
        ...previous,
        path: target,
        changed: false,
      };
    }

    const relativePath =
      previous?.relativePath ||
      `${createHash("sha256").update(id).digest("hex").slice(0, 10)}-${safeBasename(name)}`;
    const target = resolveInside(directory, relativePath);
    const hash = createHash("sha256").update(value.content).digest("hex");
    const changed =
      !previous || previous.sha256 !== hash || !fs.existsSync(target);
    if (changed) {
      atomicWriteText(target, value.content);
    }

    return {
      id,
      name,
      relativePath,
      path: target,
      length: value.content.length,
      sha256: hash,
      editorIndex: Number.isInteger(value.editorIndex) ? value.editorIndex : 0,
      capturedAt: Number.isFinite(value.capturedAt) ? value.capturedAt : Date.now(),
      changed,
    };
  }

  #readConfiguredDirectory() {
    if (!fs.existsSync(this.configPath)) return this.defaultDirectory;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      return resolveWorkspaceDirectory(
        parsed?.directory,
        this.defaultDirectory,
      );
    } catch {
      return this.defaultDirectory;
    }
  }
}

function resolveWorkspaceDirectory(value, defaultDirectory) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return defaultDirectory;
  const expanded =
    raw === "~"
      ? os.homedir()
      : raw.startsWith("~/")
        ? path.join(os.homedir(), raw.slice(2))
        : raw;
  if (!path.isAbsolute(expanded)) {
    throw new Error("工作区目录必须是绝对路径，或以 ~/ 开头。");
  }
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) {
    throw new Error("不能把磁盘根目录用作工作区目录。");
  }
  return resolved;
}

function assertDirectoriesAreIndependent(left, right) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  if (
    (!relative.startsWith("..") && !path.isAbsolute(relative)) ||
    (!reverse.startsWith("..") && !path.isAbsolute(reverse))
  ) {
    throw new Error("新旧工作区目录不能互相嵌套。");
  }
}

function migrateWorkspaceDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    fs.cpSync(from, to, {
      recursive: entry.isDirectory(),
      force: false,
      errorOnExist: false,
      dereference: false,
      preserveTimestamps: true,
    });
  }
}

function normalizeWorkspaceId(value) {
  const raw = normalizeRawWorkspaceId(value);
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function normalizeRawWorkspaceId(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new Error("A workspace id is required for attached files.");
  if (raw.length > 1_000) throw new Error("Workspace id is too long.");
  return raw;
}

function normalizeDisplayName(value, index) {
  const raw =
    typeof value === "string" && value.trim()
      ? value.trim()
      : `attached-file-${index + 1}`;
  return raw.replace(/[\r\n\t]/g, " ").slice(0, 500);
}

function safeBasename(value) {
  const basename = path.basename(value).replace(/[^\p{L}\p{N}._ -]+/gu, "_");
  return basename.slice(0, 180) || "attached-file";
}

function resolveInside(directory, relativePath) {
  const resolved = path.resolve(directory, relativePath);
  if (resolved === directory || !resolved.startsWith(`${directory}${path.sep}`)) {
    throw new Error("Attached file path escaped its isolated workspace.");
  }
  return resolved;
}

function normalizeProjectPath(value) {
  const raw = String(value || "").replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/")) {
    throw new Error("Overleaf project contains an invalid file path.");
  }
  const segments = raw.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.some((segment) => segment === "..")) {
    throw new Error(`Overleaf project contains an unsafe file path: ${raw}`);
  }
  return segments.join("/");
}

function normalizeHistoryVersion(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Overleaf ${label}历史版本无效。`);
  }
  return number;
}

function normalizeBlobHash(value) {
  const hash = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{40}$/.test(hash)) {
    throw new Error("Overleaf 变化文件哈希无效。");
  }
  return hash;
}

function applyRawProjectOperation({
  operation,
  stagedByPath,
  directory,
  container,
  usedBlobHashes,
}) {
  if (!operation || typeof operation !== "object") {
    throw new Error("Overleaf 项目增量操作无效。");
  }
  if ("file" in operation) {
    const relativePath = normalizeProjectPath(operation.pathname);
    const content = materializeRawProjectFile(
      operation.file,
      container,
      usedBlobHashes,
    );
    stagedByPath.set(relativePath, {
      relativePath,
      content,
      dirty: true,
    });
    return;
  }
  if ("newPathname" in operation) {
    const relativePath = normalizeProjectPath(operation.pathname);
    const nextRaw = String(operation.newPathname || "");
    const current = stagedByPath.get(relativePath);
    if (!current) {
      throw new Error(`Overleaf 增量要移动的文件不存在：${relativePath}`);
    }
    stagedByPath.delete(relativePath);
    if (!nextRaw) return;
    const nextPath = normalizeProjectPath(nextRaw);
    if (stagedByPath.has(nextPath)) {
      throw new Error(`Overleaf 增量目标路径已存在：${nextPath}`);
    }
    stagedByPath.set(nextPath, {
      ...current,
      relativePath: nextPath,
      content:
        current.content ??
        fs.readFileSync(resolveInside(directory, relativePath)),
      dirty: true,
    });
    return;
  }
  if ("textOperation" in operation) {
    const relativePath = normalizeProjectPath(operation.pathname);
    const current = stagedByPath.get(relativePath);
    if (!current) {
      throw new Error(`Overleaf 增量要编辑的文件不存在：${relativePath}`);
    }
    const before =
      current.content ?? fs.readFileSync(resolveInside(directory, relativePath));
    const after = applyRawTextOperation(before.toString("utf8"), operation);
    stagedByPath.set(relativePath, {
      ...current,
      content: Buffer.from(after, "utf8"),
      dirty: true,
    });
    return;
  }
  if (
    "metadata" in operation ||
    "commentId" in operation ||
    "deleteComment" in operation ||
    "noOp" in operation ||
    Object.keys(operation).length === 0
  ) {
    return;
  }
  throw new Error(
    `Overleaf 项目包含未知增量操作：${JSON.stringify(operation).slice(0, 500)}`,
  );
}

function materializeRawProjectFile(file, container, usedBlobHashes) {
  if (!file || typeof file !== "object") {
    throw new Error("Overleaf 新增文件记录无效。");
  }
  if (typeof file.content === "string") {
    return Buffer.from(file.content, "utf8");
  }
  const hash = normalizeBlobHash(file.hash);
  const stagingPath = path.join(container, PROJECT_STAGING_DIRECTORY, hash);
  if (!isRegularFile(stagingPath)) {
    throw new Error(`Overleaf 变化文件尚未下载：${hash}`);
  }
  const content = fs.readFileSync(stagingPath);
  const actualHash = createHash("sha1").update(content).digest("hex");
  if (actualHash !== hash) {
    throw new Error(`Overleaf 变化文件校验失败：${hash}`);
  }
  usedBlobHashes.add(hash);

  const hasStringLength =
    typeof file.stringLength === "number" &&
    Number.isSafeInteger(file.stringLength) &&
    file.stringLength >= 0;
  if (hasStringLength || Array.isArray(file.operations)) {
    let text = content.toString("utf8");
    for (const operation of Array.isArray(file.operations)
      ? file.operations
      : []) {
      if (operation && Array.isArray(operation.textOperation)) {
        text = applyRawTextOperation(text, operation);
      }
    }
    if (
      hasStringLength &&
      text.length !== file.stringLength
    ) {
      throw new Error(
        `Overleaf 文本文件长度校验失败：期望 ${file.stringLength}，实际 ${text.length}。`,
      );
    }
    return Buffer.from(text, "utf8");
  }
  return content;
}

function applyRawTextOperation(input, operation) {
  if (!Array.isArray(operation?.textOperation)) {
    throw new Error("Overleaf 文本增量格式无效。");
  }
  let cursor = 0;
  let output = "";
  for (const scan of operation.textOperation) {
    if (typeof scan === "number") {
      if (!Number.isSafeInteger(scan) || scan === 0) {
        throw new Error("Overleaf 文本增量长度无效。");
      }
      if (scan > 0) {
        if (cursor + scan > input.length) {
          throw new Error("Overleaf 文本增量保留范围超出文件长度。");
        }
        output += input.slice(cursor, cursor + scan);
        cursor += scan;
      } else {
        cursor += -scan;
        if (cursor > input.length) {
          throw new Error("Overleaf 文本增量删除范围超出文件长度。");
        }
      }
      continue;
    }
    if (typeof scan === "string") {
      output += scan;
      continue;
    }
    if (scan && typeof scan === "object" && typeof scan.i === "string") {
      output += scan.i;
      continue;
    }
    if (
      scan &&
      typeof scan === "object" &&
      Number.isSafeInteger(scan.r) &&
      scan.r > 0
    ) {
      if (cursor + scan.r > input.length) {
        throw new Error("Overleaf 文本增量保留范围超出文件长度。");
      }
      output += input.slice(cursor, cursor + scan.r);
      cursor += scan.r;
      continue;
    }
    throw new Error("Overleaf 文本增量包含未知操作。");
  }
  if (cursor !== input.length) {
    throw new Error(
      `Overleaf 文本增量未覆盖完整文件：${cursor}/${input.length}。`,
    );
  }
  return output;
}

function removeStagedProjectBlobs(container, hashes) {
  const stagingDirectory = path.join(container, PROJECT_STAGING_DIRECTORY);
  if (!fs.existsSync(stagingDirectory)) return;
  for (const hash of hashes) {
    const target = path.join(stagingDirectory, normalizeBlobHash(hash));
    if (isRegularFile(target)) fs.unlinkSync(target);
  }
  if (!fs.readdirSync(stagingDirectory).length) {
    fs.rmdirSync(stagingDirectory);
  }
}

function readManifest(directory) {
  const filePath = path.join(directory, MANIFEST_FILE);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed?.files)
      ? parsed.files.filter(
          (file) =>
            file &&
            typeof file.id === "string" &&
            typeof file.name === "string" &&
            typeof file.relativePath === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function readProjectManifest(filePath) {
  if (!fs.existsSync(filePath)) return { project: null, files: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const files = Array.isArray(parsed?.files)
      ? parsed.files.filter(
          (file) =>
            file &&
            typeof file.relativePath === "string" &&
            typeof file.sha256 === "string",
        )
      : [];
    return {
      project:
        parsed?.project && typeof parsed.project === "object"
          ? parsed.project
          : null,
      files,
    };
  } catch {
    return { project: null, files: [] };
  }
}

function publicFile(file) {
  return {
    id: file.id,
    name: file.name,
    relativePath: file.relativePath,
    length: file.length,
    sha256: file.sha256,
    mtimeMs: file.mtimeMs,
    editorIndex: file.editorIndex,
    capturedAt: file.capturedAt,
  };
}

function isRegularFile(filePath) {
  return fs.existsSync(filePath) && fs.lstatSync(filePath).isFile();
}

function pruneUntrackedProjectPaths(root, retainedPaths, directory = root) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const relativePath = path.relative(root, target).split(path.sep).join("/");
    if (entry.isDirectory()) {
      pruneUntrackedProjectPaths(root, retainedPaths, target);
      if (!fs.readdirSync(target).length) fs.rmdirSync(target);
      continue;
    }
    if (!retainedPaths.has(relativePath)) fs.unlinkSync(target);
  }
}

function atomicWriteBuffer(filePath, value) {
  const temporary = `${filePath}.tmp-${randomBytes(8).toString("hex")}`;
  fs.writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath);
}

function atomicWriteText(filePath, value) {
  atomicWriteBuffer(filePath, Buffer.from(value, "utf8"));
}

function atomicWriteJson(filePath, value) {
  atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
