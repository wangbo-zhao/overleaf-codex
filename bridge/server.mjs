import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { CodexAppServer } from "./codex-app-server.mjs";
import { HistoryStore } from "./history-store.mjs";
import { JobManager } from "./job-manager.mjs";
import { WorkspaceStore } from "./workspace-store.mjs";

const args = new Set(process.argv.slice(2));
const portArgIndex = process.argv.indexOf("--port");
const port = Number(
  process.env.OVERLEAF_CODEX_PORT ||
    (portArgIndex >= 0 ? process.argv[portArgIndex + 1] : 47831),
);
const host = "127.0.0.1";
const MAX_PROJECT_ARCHIVE_BYTES = 512_000_000;
const stateDirectory =
  process.env.OVERLEAF_CODEX_STATE_DIR || path.join(os.homedir(), ".overleaf-codex");
const safeCwd =
  process.env.OVERLEAF_CODEX_WORK_DIR || path.join(stateDirectory, "codex-workspace");

fs.mkdirSync(safeCwd, { recursive: true, mode: 0o700 });
const token = resolveToken(stateDirectory);

if (args.has("--show-token")) {
  process.stdout.write(`${token}\n`);
  process.exit(0);
}

const client = new CodexAppServer();
const workspaceStore = new WorkspaceStore({
  rootDirectory: safeCwd,
  stateDirectory,
});
const jobs = new JobManager({ client, cwd: safeCwd, workspaceStore });
const history = new HistoryStore({ stateDirectory });

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (!authorize(request, token)) {
      sendJson(response, 401, { error: "Invalid bridge token." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/health") {
      sendJson(response, 200, {
        ok: true,
        service: "overleaf-codex-bridge",
        version: "1.7.0",
        codexRunning: client.running,
        historyDirectory: history.getConfig().directory,
        workspaceDirectory: workspaceStore.getConfig().directory,
        tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 8),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/workspace/config") {
      sendJson(response, 200, workspaceStore.getConfig());
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/workspace/config") {
      const body = await readJson(request);
      sendJson(response, 200, workspaceStore.setDirectory(body.directory));
      return;
    }

    const workspaceStateMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/state$/,
    );
    if (request.method === "GET" && workspaceStateMatch) {
      const projectId = decodeURIComponent(workspaceStateMatch[1]);
      const origin = normalizeOverleafOrigin(
        decodeHeader(request.headers["x-overleaf-origin"]),
      );
      const workspaceId = `${origin}|${projectId}`;
      sendJson(response, 200, workspaceStore.getProjectState(workspaceId));
      return;
    }

    const workspaceSyncMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/sync$/,
    );
    if (request.method === "POST" && workspaceSyncMatch) {
      const projectId = decodeURIComponent(workspaceSyncMatch[1]);
      const origin = normalizeOverleafOrigin(
        decodeHeader(request.headers["x-overleaf-origin"]),
      );
      const projectName =
        decodeHeader(request.headers["x-overleaf-project-name"]) ||
        "Overleaf project";
      const historyVersion =
        decodeHeader(request.headers["x-overleaf-history-version"]) || null;
      const archive = await readBinary(request, MAX_PROJECT_ARCHIVE_BYTES);
      const workspaceId = `${origin}|${projectId}`;
      const synced = workspaceStore.syncProject(workspaceId, archive, {
        projectId,
        projectName,
        origin,
        historyVersion,
      });
      sendJson(response, 200, {
        synced: true,
        workspaceId,
        projectId,
        projectName: synced.project.projectName,
        historyVersion: synced.project.historyVersion,
        syncedAt: synced.project.syncedAt,
        fileCount: synced.project.fileCount,
        totalBytes: synced.project.totalBytes,
        changedCount: synced.changedCount,
        deletedCount: synced.deletedCount,
      });
      return;
    }

    const workspaceBlobMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/blobs\/([a-f0-9]{40})$/,
    );
    if (request.method === "PUT" && workspaceBlobMatch) {
      const projectId = decodeURIComponent(workspaceBlobMatch[1]);
      const origin = normalizeOverleafOrigin(
        decodeHeader(request.headers["x-overleaf-origin"]),
      );
      const workspaceId = `${origin}|${projectId}`;
      const content = await readBinary(
        request,
        MAX_PROJECT_ARCHIVE_BYTES,
        true,
      );
      sendJson(
        response,
        200,
        workspaceStore.stageProjectBlob(
          workspaceId,
          workspaceBlobMatch[2],
          content,
        ),
      );
      return;
    }

    const workspaceIncrementalSyncMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/incremental-sync$/,
    );
    if (request.method === "POST" && workspaceIncrementalSyncMatch) {
      const projectId = decodeURIComponent(workspaceIncrementalSyncMatch[1]);
      const origin = normalizeOverleafOrigin(
        decodeHeader(request.headers["x-overleaf-origin"]),
      );
      const workspaceId = `${origin}|${projectId}`;
      const body = await readJson(request);
      const synced = workspaceStore.syncProjectChanges(workspaceId, body, {
        projectId,
        origin,
      });
      sendJson(response, 200, {
        synced: true,
        incremental: true,
        workspaceId,
        projectId,
        projectName: synced.project.projectName,
        historyVersion: synced.project.historyVersion,
        syncedAt: synced.project.syncedAt,
        fileCount: synced.project.fileCount,
        totalBytes: synced.project.totalBytes,
        changedCount: synced.changedCount,
        deletedCount: synced.deletedCount,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/history/config") {
      sendJson(response, 200, history.getConfig());
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/history/config") {
      const body = await readJson(request);
      sendJson(response, 200, history.setDirectory(body.directory));
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/history") {
      sendJson(response, 200, { conversations: history.list() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/history") {
      const body = await readJson(request);
      sendJson(response, 200, {
        saved: true,
        conversations: history.save(body.conversation),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/history/import") {
      const body = await readJson(request);
      sendJson(response, 200, {
        imported: true,
        conversations: history.import(body.conversations),
      });
      return;
    }

    const historyDeleteMatch = url.pathname.match(/^\/v1\/history\/([^/]+)$/);
    if (request.method === "DELETE" && historyDeleteMatch) {
      sendJson(response, 200, {
        deleted: true,
        conversations: history.delete(decodeURIComponent(historyDeleteMatch[1])),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/plugins") {
      const plugins = await jobs.listPlugins({
        force: url.searchParams.get("force") === "true",
      });
      sendJson(response, 200, { plugins });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      const models = await jobs.listModels({
        force: url.searchParams.get("force") === "true",
      });
      sendJson(response, 200, { models });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/turns") {
      const body = await readJson(request);
      const started = await jobs.startTurn(body);
      sendJson(response, 202, started);
      return;
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch) {
      const after = Number(url.searchParams.get("after") || 0);
      const job = jobs.getJob(jobMatch[1], Number.isFinite(after) ? after : 0);
      if (!job) {
        sendJson(response, 404, { error: "Unknown job." });
      } else {
        sendJson(response, 200, job);
      }
      return;
    }

    const respondMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/requests\/([^/]+)$/);
    if (request.method === "POST" && respondMatch) {
      const body = await readJson(request);
      const result = await jobs.respond(respondMatch[1], respondMatch[2], body);
      sendJson(response, 200, result);
      return;
    }

    const interruptMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/interrupt$/);
    if (request.method === "POST" && interruptMatch) {
      const result = await jobs.interrupt(interruptMatch[1]);
      sendJson(response, 200, result);
      return;
    }

    const steerMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/steer$/);
    if (request.method === "POST" && steerMatch) {
      const body = await readJson(request);
      const result = await jobs.steer(
        steerMatch[1],
        body.message,
        body.selectionReferences !== undefined
          ? body.selectionReferences
          : body.selectionReference,
      );
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    const status = /JSON|body|Message|required|selection|history|directory|目录|conversation|attached file|workspace|文件上下文|Overleaf|project|archive|zip|解压|同步/i.test(
      error.message,
    )
      ? 400
      : 500;
    sendJson(response, status, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Overleaf Codex bridge: http://${host}:${port}`);
  console.log(`Bridge token: ${token}`);
  try {
    console.log(`Codex executable: ${client.command || "(首次请求时自动探测)"}`);
  } catch {
    // Executable discovery errors are returned to the extension on first use.
  }
  console.log("Keep this terminal open while using the extension.");
});

function resolveToken(directory) {
  if (process.env.OVERLEAF_CODEX_TOKEN) return process.env.OVERLEAF_CODEX_TOKEN;
  const tokenPath = path.join(directory, "token");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, "utf8").trim();
  const generated = randomBytes(24).toString("base64url");
  fs.writeFileSync(tokenPath, `${generated}\n`, { mode: 0o600, flag: "wx" });
  return generated;
}

function authorize(request, expectedToken) {
  const header = request.headers.authorization || "";
  return header === `Bearer ${expectedToken}`;
}

function setSecurityHeaders(response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readBinary(request, maximumBytes, allowEmpty = false) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new Error("Overleaf project archive is too large.");
    }
    chunks.push(chunk);
  }
  if (!chunks.length && !allowEmpty) {
    throw new Error("Overleaf project archive is empty.");
  }
  return Buffer.concat(chunks);
}

function decodeHeader(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function normalizeOverleafOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Overleaf origin.");
  }
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "overleaf.com" ||
      url.hostname.endsWith(".overleaf.com")
    )
  ) {
    throw new Error("Only authenticated overleaf.com projects can be synced.");
  }
  return url.origin;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    client.stop();
    server.close(() => process.exit(0));
  });
}
