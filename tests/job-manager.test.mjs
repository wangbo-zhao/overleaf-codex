import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { JobManager } from "../bridge/job-manager.mjs";

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.responses = [];
  }

  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "plugin/list") {
      return {
        marketplaces: [
          {
            name: "local",
            path: "/tmp/marketplace.json",
            plugins: [
              {
                id: "plugin-id",
                name: "research",
                installed: true,
                enabled: true,
                installPolicy: "AVAILABLE",
                authPolicy: "ON_USE",
                source: { type: "local", path: "/tmp/research" },
              },
            ],
          },
        ],
      };
    }
    if (method === "model/list") {
      return {
        data: [
          {
            id: "model-a",
            model: "model-a",
            displayName: "Model A",
            description: "Test model",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Fast" },
              { reasoningEffort: "medium", description: "Balanced" },
            ],
          },
        ],
        nextCursor: null,
      };
    }
    if (method === "plugin/read") {
      return {
        plugin: {
          skills: [
            {
              name: "research-skill",
              enabled: true,
              path: "/tmp/research/skills/research/SKILL.md",
            },
          ],
        },
      };
    }
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") return { turn: { id: "turn-1" } };
    if (method === "turn/steer") return { turnId: "turn-1" };
    if (method === "turn/interrupt") return {};
    throw new Error(`Unexpected method: ${method}`);
  }

  respond(id, result) {
    this.responses.push({ id, result });
  }

  respondError(id, code, message) {
    this.responses.push({ id, error: { code, message } });
  }
}

test("JobManager starts a plugin-backed turn and returns structured result events", async () => {
  const client = new FakeClient();
  const manager = new JobManager({ client, cwd: "/tmp/overleaf-codex" });
  const started = await manager.startTurn({
    message: "Rewrite this.",
    selection: "Original.",
    pluginIds: ["plugin-id"],
    model: "model-a",
    effort: "low",
  });

  assert.equal(started.threadId, "thread-1");
  const turnCall = client.calls.find((call) => call.method === "turn/start");
  assert.equal(turnCall.params.input[1].type, "skill");
  assert.equal(turnCall.params.model, "model-a");
  assert.equal(turnCall.params.effort, "low");
  assert.equal(turnCall.params.summary, "auto");

  client.emit("notification", {
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { id: "reasoning-1", type: "reasoning", summary: [] },
    },
  });
  client.emit("notification", {
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "reasoning-1",
      summaryIndex: 0,
      delta: "Checking subject-verb agreement.",
    },
  });
  client.emit("notification", {
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "commentary-1",
        type: "agentMessage",
        text: "",
        phase: "commentary",
      },
    },
  });
  client.emit("notification", {
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "commentary-1",
      delta: "I’ll preserve the LaTeX command.",
    },
  });

  client.emit("notification", {
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        items: [
          {
            type: "agentMessage",
            text: JSON.stringify({
              message: "Done.",
              replacement: "Rewritten.",
              warnings: [],
            }),
          },
        ],
      },
    },
  });

  const job = manager.getJob(started.jobId, 0);
  assert.equal(job.status, "completed");
  assert.equal(
    job.events.find((event) => event.type === "reasoning_delta").data.delta,
    "Checking subject-verb agreement.",
  );
  assert.equal(
    job.events.find((event) => event.type === "commentary_delta").data.delta,
    "I’ll preserve the LaTeX command.",
  );
  assert.deepEqual(job.events.at(-1).data, {
    message: "Done.",
    replacement: "Rewritten.",
    replacements: [],
    warnings: [],
  });
});

test("JobManager starts a file-only turn in the mirrored Overleaf workspace", async () => {
  const client = new FakeClient();
  const workspaceStore = {
    sync(workspaceId, files) {
      assert.equal(workspaceId, "conversation-1");
      assert.equal(files[0].content, "\\section{Intro}");
      return {
        id: "workspace-1",
        directory: "/tmp/overleaf-workspace",
        files: [
          {
            id: "0:main.tex",
            name: "main.tex",
            path: "/tmp/overleaf-workspace/main.tex",
            length: 15,
            sha256: "a".repeat(64),
            editorIndex: 0,
            capturedAt: 1,
            changed: true,
          },
        ],
      };
    },
  };
  const manager = new JobManager({
    client,
    cwd: "/tmp/overleaf-codex",
    workspaceStore,
  });
  const started = await manager.startTurn({
    message: "Summarize this file.",
    selection: "",
    workspaceId: "conversation-1",
    files: [{ id: "0:main.tex", name: "main.tex", content: "\\section{Intro}" }],
  });

  const threadCall = client.calls.find((call) => call.method === "thread/start");
  const turnCall = client.calls.find((call) => call.method === "turn/start");
  assert.equal(threadCall.params.cwd, "/tmp/overleaf-workspace");
  assert.equal(turnCall.params.cwd, "/tmp/overleaf-workspace");
  assert.deepEqual(turnCall.params.input[1], {
    type: "mention",
    name: "main.tex",
    path: "/tmp/overleaf-workspace/main.tex",
  });
  assert.equal(started.files[0].name, "main.tex");
  assert.equal(started.files[0].sha256, "a".repeat(64));
  assert.equal(started.files[0].changed, true);
});

test("JobManager opens a synchronized Overleaf project without explicit attachments", async () => {
  const client = new FakeClient();
  const workspaceStore = {
    openProject(workspaceId) {
      assert.equal(workspaceId, "https://www.overleaf.com|project-1");
      return {
        id: workspaceId,
        directory: "/tmp/overleaf-project/project",
        files: [
          {
            id: "main.tex",
            name: "main.tex",
            relativePath: "main.tex",
            path: "/tmp/overleaf-project/project/main.tex",
            length: 20,
            sha256: "b".repeat(64),
          },
        ],
        project: {
          projectId: "project-1",
          projectName: "Paper",
          historyVersion: "12",
          syncedAt: 123,
          fileCount: 1,
          totalBytes: 20,
        },
      };
    },
  };
  const manager = new JobManager({
    client,
    cwd: "/tmp/overleaf-codex",
    workspaceStore,
  });
  const started = await manager.startTurn({
    message: "Find the main contribution.",
    selection: "",
    workspaceId: "https://www.overleaf.com|project-1",
    project: { synced: true },
    files: [],
  });

  const threadCall = client.calls.find((call) => call.method === "thread/start");
  const turnCall = client.calls.find((call) => call.method === "turn/start");
  assert.equal(threadCall.params.cwd, "/tmp/overleaf-project/project");
  assert.equal(turnCall.params.cwd, "/tmp/overleaf-project/project");
  assert.equal(turnCall.params.input.length, 1);
  assert.match(turnCall.params.input[0].text, /complete, freshly synchronized/);
  assert.match(turnCall.params.input[0].text, /Paper/);
  assert.equal(started.project.fileCount, 1);
  assert.deepEqual(started.files, []);
});

test("JobManager resolves a browser selection to the synchronized project file", async () => {
  const client = new FakeClient();
  const workspaceStore = {
    openProject() {
      return {
        id: "workspace-selection",
        directory: "/tmp/overleaf-project/project",
        files: [
          {
            id: "sections/method.tex",
            name: "method.tex",
            relativePath: "sections/method.tex",
            path: "/tmp/overleaf-project/project/sections/method.tex",
            length: 500,
            sha256: "c".repeat(64),
          },
        ],
        project: {
          projectId: "project-1",
          projectName: "Paper",
          historyVersion: "13",
          syncedAt: 456,
          fileCount: 1,
          totalBytes: 500,
        },
      };
    },
  };
  const manager = new JobManager({
    client,
    cwd: "/tmp/overleaf-codex",
    workspaceStore,
  });
  const started = await manager.startTurn({
    message: "Explain the selected proof.",
    selection: "Raw browser selection should not be duplicated.",
    selectionReference: {
      relativePath: "sections/method.tex",
      name: "method.tex",
      startLine: 8,
      endLine: 13,
    },
    workspaceId: "workspace-selection",
    project: { synced: true },
    files: [],
  });

  const turnCall = client.calls.find((call) => call.method === "turn/start");
  assert.doesNotMatch(turnCall.params.input[0].text, /Raw browser selection/);
  assert.match(turnCall.params.input[0].text, /"file":"sections\/method\.tex"/);
  assert.deepEqual(turnCall.params.input[1], {
    type: "mention",
    name: "sections/method.tex",
    path: "/tmp/overleaf-project/project/sections/method.tex",
  });
  assert.deepEqual(started.selectionReference, {
    name: "sections/method.tex",
    relativePath: "sections/method.tex",
    startLine: 8,
    endLine: 13,
  });
});

test("JobManager safely falls back to raw text when a file reference is ambiguous", async () => {
  const client = new FakeClient();
  const workspaceStore = {
    openProject() {
      return {
        id: "workspace-ambiguous",
        directory: "/tmp/overleaf-project/project",
        files: [
          {
            id: "a/main.tex",
            relativePath: "a/main.tex",
            path: "/tmp/overleaf-project/project/a/main.tex",
          },
          {
            id: "b/main.tex",
            relativePath: "b/main.tex",
            path: "/tmp/overleaf-project/project/b/main.tex",
          },
        ],
        project: { projectName: "Paper", fileCount: 2 },
      };
    },
  };
  const manager = new JobManager({
    client,
    cwd: "/tmp/overleaf-codex",
    workspaceStore,
    logger: { warn() {} },
  });
  const started = await manager.startTurn({
    message: "Rewrite this.",
    selection: "Exact selected sentence.",
    selectionReference: {
      relativePath: "main.tex",
      startLine: 3,
      endLine: 3,
    },
    workspaceId: "workspace-ambiguous",
    project: { synced: true },
  });

  const turnCall = client.calls.find((call) => call.method === "turn/start");
  assert.match(turnCall.params.input[0].text, /Exact selected sentence/);
  assert.equal(turnCall.params.input.length, 1);
  assert.deepEqual(started.selectionReference, {
    type: "text",
    length: "Exact selected sentence.".length,
  });
});

test("JobManager resolves multiple file-range references in one turn", async () => {
  const client = new FakeClient();
  const workspaceStore = {
    openProject() {
      return {
        id: "workspace-multiple",
        directory: "/tmp/overleaf-project/project",
        files: [
          {
            id: "main.tex",
            name: "main.tex",
            relativePath: "main.tex",
            path: "/tmp/overleaf-project/project/main.tex",
          },
          {
            id: "sections/method.tex",
            name: "method.tex",
            relativePath: "sections/method.tex",
            path: "/tmp/overleaf-project/project/sections/method.tex",
          },
        ],
        project: { projectName: "Paper", fileCount: 2 },
      };
    },
  };
  const manager = new JobManager({
    client,
    cwd: "/tmp/overleaf-codex",
    workspaceStore,
  });
  const started = await manager.startTurn({
    message: "Compare these passages.",
    selection: "",
    selectionReferences: [
      { relativePath: "main.tex", startLine: 2, endLine: 4 },
      {
        relativePath: "sections/method.tex",
        startLine: 18,
        endLine: 22,
      },
    ],
    workspaceId: "workspace-multiple",
    project: { synced: true },
  });

  const turnCall = client.calls.find((call) => call.method === "turn/start");
  assert.match(turnCall.params.input[0].text, /"file":"main\.tex"/);
  assert.match(
    turnCall.params.input[0].text,
    /"file":"sections\/method\.tex"/,
  );
  assert.equal(
    turnCall.params.input.filter((item) => item.type === "mention").length,
    2,
  );
  assert.equal(started.selectionReferences.length, 2);

  await manager.steer(started.jobId, "Re-check the updated ranges.", [
    { relativePath: "main.tex", startLine: 3, endLine: 5 },
    {
      relativePath: "sections/method.tex",
      startLine: 20,
      endLine: 24,
    },
  ]);
  const steerCall = client.calls.find((call) => call.method === "turn/steer");
  assert.match(steerCall.params.input[0].text, /"startLine":3/);
  assert.match(steerCall.params.input[0].text, /"startLine":20/);
  assert.equal(
    steerCall.params.input.filter((item) => item.type === "mention").length,
    2,
  );
});

test("JobManager rejects a turn with neither selection nor files", async () => {
  const client = new FakeClient();
  const manager = new JobManager({ client, cwd: "/tmp/overleaf-codex" });
  await assert.rejects(
    manager.startTurn({ message: "What should I do?", selection: "", files: [] }),
    /selection, file-range reference, attached file, or project/i,
  );
});

test("JobManager routes command approval back to App Server", async () => {
  const client = new FakeClient();
  const manager = new JobManager({ client, cwd: "/tmp/overleaf-codex" });
  const started = await manager.startTurn({
    message: "Check this.",
    selection: "Text.",
  });

  client.emit("serverRequest", {
    id: 91,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      startedAtMs: Date.now(),
      command: "example-command",
    },
  });

  const job = manager.getJob(started.jobId, 0);
  const approval = job.events.find((event) => event.type === "approval");
  assert.equal(approval.data.requestId, "91");

  await manager.respond(started.jobId, "91", { action: "approve" });
  assert.deepEqual(client.responses, [{ id: 91, result: { decision: "accept" } }]);
});

test("JobManager steers an active turn", async () => {
  const client = new FakeClient();
  const manager = new JobManager({ client, cwd: "/tmp/overleaf-codex" });
  const started = await manager.startTurn({
    message: "Rewrite this.",
    selection: "Text.",
  });

  const result = await manager.steer(started.jobId, "Keep the equation unchanged.");
  const steerCall = client.calls.find((call) => call.method === "turn/steer");
  assert.equal(result.turnId, "turn-1");
  assert.equal(steerCall.params.threadId, "thread-1");
  assert.equal(steerCall.params.expectedTurnId, "turn-1");
  assert.deepEqual(steerCall.params.input, [
    { type: "text", text: "Keep the equation unchanged." },
  ]);
});

test("JobManager steers with the latest synchronized selection reference", async () => {
  const client = new FakeClient();
  const workspaceStore = {
    openProject(workspaceId) {
      assert.equal(workspaceId, "workspace-steer");
      return {
        id: workspaceId,
        directory: "/tmp/latest-overleaf-project",
        files: [
          {
            id: "main.tex",
            name: "main.tex",
            relativePath: "main.tex",
            path: "/tmp/latest-overleaf-project/main.tex",
            length: 700,
            sha256: "d".repeat(64),
          },
        ],
        project: {
          projectId: "project-steer",
          projectName: "Paper",
          fileCount: 1,
        },
      };
    },
  };
  const manager = new JobManager({
    client,
    cwd: "/tmp/overleaf-codex",
    workspaceStore,
  });
  const started = await manager.startTurn({
    message: "Review this paragraph.",
    selection: "",
    selectionReference: {
      relativePath: "main.tex",
      name: "main.tex",
      startLine: 20,
      endLine: 24,
    },
    workspaceId: "workspace-steer",
    project: { synced: true },
  });

  await manager.steer(started.jobId, "Now focus on the citation.", {
    relativePath: "main.tex",
    name: "main.tex",
    startLine: 20,
    endLine: 25,
  });

  const steerCall = client.calls.find((call) => call.method === "turn/steer");
  assert.match(steerCall.params.input[0].text, /"startLine":20/);
  assert.match(steerCall.params.input[0].text, /"endLine":25/);
  assert.deepEqual(steerCall.params.input[1], {
    type: "mention",
    name: "main.tex",
    path: "/tmp/latest-overleaf-project/main.tex",
  });
});

test("JobManager falls back to streamed agent deltas when turn payload omits items", async () => {
  const client = new FakeClient();
  const manager = new JobManager({ client, cwd: "/tmp/overleaf-codex" });
  const started = await manager.startTurn({
    message: "Rewrite this.",
    selection: "Text.",
  });

  const structured = JSON.stringify({
    message: "Streamed.",
    replacement: "Better text.",
    warnings: [],
  });
  client.emit("notification", {
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "agent-1",
      delta: structured.slice(0, 20),
    },
  });
  client.emit("notification", {
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "agent-1",
      delta: structured.slice(20),
    },
  });
  client.emit("notification", {
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "completed", items: [] },
    },
  });

  const job = manager.getJob(started.jobId, 0);
  assert.deepEqual(job.events.at(-1).data, {
    message: "Streamed.",
    replacement: "Better text.",
    replacements: [],
    warnings: [],
  });
});
