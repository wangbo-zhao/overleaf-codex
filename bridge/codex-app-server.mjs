import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const MACOS_CODEX_LOCATIONS = [
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "/Applications/Codex.app/Contents/Resources/codex",
];

export function resolveCodexCommand({
  env = process.env,
  platform = process.platform,
  homeDirectory = os.homedir(),
  isExecutable = defaultIsExecutable,
} = {}) {
  const override = env.OVERLEAF_CODEX_COMMAND?.trim();
  if (override) {
    const resolvedOverride = findExecutable(override, { env, platform, isExecutable });
    if (resolvedOverride) return resolvedOverride;
    throw new Error(
      `OVERLEAF_CODEX_COMMAND 指向的 Codex 不可执行：${override}。` +
        "请改为 Codex 可执行文件的绝对路径并重启桥接服务。",
    );
  }

  const fromPath = findExecutable("codex", { env, platform, isExecutable });
  if (fromPath) return fromPath;

  const appLocations =
    platform === "darwin"
      ? [
          ...MACOS_CODEX_LOCATIONS,
          path.join(homeDirectory, "Applications/ChatGPT.app/Contents/Resources/codex"),
          path.join(homeDirectory, "Applications/Codex.app/Contents/Resources/codex"),
        ]
      : [];
  const commonLocations = [
    ...appLocations,
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  const bundled = commonLocations.find((candidate) => isExecutable(candidate));
  if (bundled) return bundled;

  throw new Error(
    "找不到 Codex 可执行文件。请先安装或启动 Codex；如果已经安装，" +
      "请设置 OVERLEAF_CODEX_COMMAND 为 Codex 的绝对路径后重启桥接服务。",
  );
}

function findExecutable(command, { env, platform, isExecutable }) {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return isExecutable(command) ? command : null;
  }

  const pathEntries = (env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions =
    platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function defaultIsExecutable(candidate) {
  try {
    fs.accessSync(
      candidate,
      process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

export class CodexAppServer extends EventEmitter {
  constructor({ command = null, logger = console } = {}) {
    super();
    this.command = command;
    this.logger = logger;
    this.process = null;
    this.startPromise = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  get running() {
    return Boolean(this.process && this.process.exitCode === null);
  }

  async start() {
    if (this.running) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.#startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async #startProcess() {
    this.command ||= resolveCodexCommand();
    const child = spawn(this.command, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RUST_LOG:
          process.env.OVERLEAF_CODEX_RUST_LOG ||
          process.env.RUST_LOG ||
          "error",
      },
    });
    this.process = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const message = chunk.trim();
      if (message) this.logger.warn(`[codex] ${message}`);
    });
    child.on("error", (error) => this.#handleExit(error));
    child.on("exit", (code, signal) => {
      this.#handleExit(
        new Error(`Codex App Server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`),
      );
    });

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    await this.#request("initialize", {
      clientInfo: {
        name: "overleaf_codex",
        title: "Overleaf Codex",
        version: "1.7.0",
      },
      capabilities: {
        experimentalApi: true,
        mcpServerOpenaiFormElicitation: false,
      },
    });
    this.notify("initialized", {});
    this.emit("ready");
  }

  async request(method, params = {}) {
    await this.start();
    return this.#request(method, params);
  }

  #request(method, params) {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error("Codex App Server is not writable."));
    }

    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject, method });
    });
    this.#write({ method, id, params });
    return promise;
  }

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  respond(id, result) {
    this.#write({ id, result });
  }

  respondError(id, code, message) {
    this.#write({ id, error: { code, message } });
  }

  #write(message) {
    if (!this.process?.stdin?.writable) {
      throw new Error("Codex App Server is not running.");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.logger.warn("[codex] Ignoring invalid JSON line.");
      return;
    }

    if (message.method && message.id !== undefined) {
      this.emit("serverRequest", message);
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) {
        const error = new Error(message.error.message || `Codex request ${pending.method} failed.`);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.emit("notification", message);
    }
  }

  #handleExit(error) {
    if (!this.process) return;
    this.process = null;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    this.emit("exit", error);
  }

  stop() {
    if (!this.process) return;
    this.process.kill("SIGTERM");
    this.process = null;
  }
}
