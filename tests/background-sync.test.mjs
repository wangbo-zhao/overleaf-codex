import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const backgroundSource = fs.readFileSync(
  path.join(root, "extension/background.js"),
  "utf8",
);

test("unchanged Overleaf projects skip the local incremental sync endpoint", async () => {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, method: init.method || "GET" });

    if (url.pathname.endsWith("/state")) {
      return jsonResponse({
        exists: true,
        workspaceId: "https://www.overleaf.com|project-fast",
        project: {
          projectId: "project-fast",
          projectName: "Fast paper",
          origin: "https://www.overleaf.com",
          historyVersion: "42",
          syncedAt: 100,
          fileCount: 7,
          totalBytes: 4096,
        },
        fileCount: 7,
      });
    }
    if (url.pathname.endsWith("/flush")) {
      return jsonResponse({});
    }
    if (url.pathname.endsWith("/changes")) {
      return jsonResponse({ changes: [], hasMore: false });
    }
    if (url.pathname.endsWith("/updates")) {
      return jsonResponse({ updates: [{ toV: 42 }] });
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${url.href}`);
  };
  const context = loadBackground(fetch);
  const result = await context.syncOverleafProjectNow(
    { tab: { id: 1 }, frameId: 0 },
    {
      origin: "https://www.overleaf.com",
      projectId: "project-fast",
      projectName: "Fast paper",
    },
  );

  assert.equal(result.fastPath, true);
  assert.equal(result.probeOnly, true);
  assert.equal(result.bridgeStateCacheHit, false);
  assert.equal(result.historyChangeCount, 0);
  assert.equal(result.changedCount, 0);
  assert.equal(result.fileCount, 7);
  assert.equal(result.historyVersion, "42");
  assert.equal(result.validatedAt, result.syncedAt);
  assert.ok(result.validatedAt > 100);
  assert.equal(
    calls.some(
      (call) =>
        call.method === "POST" &&
        call.url.includes("/incremental-sync"),
    ),
    false,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/flush")).length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.url.includes("/changes?")).length,
    0,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/updates")).length,
    1,
  );
  assert.equal(
    calls.some((call) => new URL(call.url).searchParams.has("min_count")),
    false,
  );
});

test("history records still advance the local mirror when no file blob is needed", async () => {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, method: init.method || "GET", body: init.body });

    if (url.pathname.endsWith("/state")) {
      return jsonResponse({
        exists: true,
        workspaceId: "https://www.overleaf.com|project-history",
        project: {
          projectId: "project-history",
          projectName: "History paper",
          origin: "https://www.overleaf.com",
          historyVersion: "42",
          syncedAt: 100,
          fileCount: 2,
          totalBytes: 1024,
        },
        fileCount: 2,
      });
    }
    if (url.pathname.endsWith("/flush")) {
      return jsonResponse({});
    }
    if (url.pathname.endsWith("/changes")) {
      return jsonResponse({
        changes: [{ operations: [{ noOp: true }] }],
        hasMore: false,
      });
    }
    if (url.pathname.endsWith("/incremental-sync")) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.fromVersion, 42);
      assert.equal(body.toVersion, 43);
      return jsonResponse({
        synced: true,
        incremental: true,
        workspaceId: "https://www.overleaf.com|project-history",
        projectId: "project-history",
        projectName: "History paper",
        historyVersion: "43",
        syncedAt: 200,
        fileCount: 2,
        totalBytes: 1024,
        changedCount: 0,
        deletedCount: 0,
      });
    }
    if (url.pathname.endsWith("/updates")) {
      return jsonResponse({ updates: [{ toV: 43 }] });
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${url.href}`);
  };
  const context = loadBackground(fetch);
  const result = await context.syncOverleafProjectNow(
    { tab: { id: 1 }, frameId: 0 },
    {
      origin: "https://www.overleaf.com",
      projectId: "project-history",
      projectName: "History paper",
    },
  );

  assert.equal(result.fastPath, false);
  assert.equal(result.probeOnly, false);
  assert.equal(result.historyChangeCount, 1);
  assert.equal(result.historyVersion, "43");
  assert.equal(
    calls.filter(
      (call) =>
        call.method === "POST" &&
        call.url.includes("/incremental-sync"),
    ).length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/flush")).length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/updates")).length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.url.includes("/changes?")).length,
    1,
  );
});

test("consecutive turn syncs reuse bridge state but still probe Overleaf", async () => {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, method: init.method || "GET" });

    if (url.pathname.endsWith("/state")) {
      return jsonResponse({
        exists: true,
        workspaceId: "https://www.overleaf.com|project-cache",
        project: {
          projectId: "project-cache",
          projectName: "Cache paper",
          origin: "https://www.overleaf.com",
          historyVersion: "17",
          syncedAt: 100,
          fileCount: 4,
          totalBytes: 2048,
        },
        fileCount: 4,
      });
    }
    if (url.pathname.endsWith("/flush")) return jsonResponse({});
    if (url.pathname.endsWith("/updates")) {
      return jsonResponse({ updates: [{ toV: 17 }] });
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${url.href}`);
  };
  const context = loadBackground(fetch);
  const sender = {
    tab: {
      id: 1,
      url: "https://www.overleaf.com/project/project-cache",
      title: "Cache paper - Overleaf",
    },
    frameId: 0,
  };

  const first = await context.syncOverleafProject(sender, {
    purpose: "turn",
  });
  const second = await context.syncOverleafProject(sender, {
    purpose: "turn",
  });

  assert.equal(first.bridgeStateCacheHit, false);
  assert.equal(second.bridgeStateCacheHit, true);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/state")).length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/flush")).length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/updates")).length,
    2,
  );
});

test("a final turn sync revalidates after an in-flight pre-sync", async () => {
  const calls = [];
  let releaseFirstProbe;
  let markFirstProbeStarted;
  const firstProbeStarted = new Promise((resolve) => {
    markFirstProbeStarted = resolve;
  });
  const firstProbeGate = new Promise((resolve) => {
    releaseFirstProbe = resolve;
  });
  let updateCount = 0;
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, method: init.method || "GET" });

    if (url.pathname.endsWith("/state")) {
      return jsonResponse({
        exists: true,
        workspaceId: "https://www.overleaf.com|project-race",
        project: {
          projectId: "project-race",
          projectName: "Race paper",
          origin: "https://www.overleaf.com",
          historyVersion: "9",
          syncedAt: 100,
          fileCount: 3,
          totalBytes: 1024,
        },
        fileCount: 3,
      });
    }
    if (url.pathname.endsWith("/flush")) return jsonResponse({});
    if (url.pathname.endsWith("/updates")) {
      updateCount += 1;
      if (updateCount === 1) {
        markFirstProbeStarted();
        await firstProbeGate;
      }
      return jsonResponse({ updates: [{ toV: 9 }] });
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${url.href}`);
  };
  const context = loadBackground(fetch);
  const sender = {
    tab: {
      id: 1,
      url: "https://www.overleaf.com/project/project-race",
      title: "Race paper - Overleaf",
    },
    frameId: 0,
  };

  const preSync = context.syncOverleafProject(sender, {
    purpose: "pre-sync",
  });
  await firstProbeStarted;
  const turnSync = context.syncOverleafProject(sender, {
    purpose: "turn",
  });
  releaseFirstProbe();

  const [preResult, turnResult] = await Promise.all([preSync, turnSync]);
  assert.equal(preResult.bridgeStateCacheHit, false);
  assert.equal(turnResult.bridgeStateCacheHit, true);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/state")).length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/flush")).length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/updates")).length,
    2,
  );
});

function loadBackground(fetch) {
  const noopListener = { addListener() {} };
  const chrome = {
    action: { onClicked: noopListener },
    commands: {
      onCommand: noopListener,
      async getAll() {
        return [];
      },
    },
    runtime: { onMessage: noopListener, openOptionsPage() {} },
    scripting: {
      async executeScript() {
        return [{ result: { csrfToken: "fixture-csrf" } }];
      },
    },
    storage: {
      local: {
        async get(defaults) {
          return {
            ...defaults,
            bridgeUrl: "http://127.0.0.1:47831",
            bridgeToken: "fixture-token",
          };
        },
        async set() {},
      },
    },
    tabs: {
      async query() {
        return [];
      },
      async sendMessage() {},
      async create() {},
    },
  };
  const context = vm.createContext({
    ArrayBuffer,
    URL,
    Uint8Array,
    chrome,
    clearTimeout,
    console,
    encodeURIComponent,
    fetch,
    setTimeout,
  });
  vm.runInContext(backgroundSource, context, {
    filename: "extension/background.js",
  });
  return context;
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() {
      return payload;
    },
  };
}
