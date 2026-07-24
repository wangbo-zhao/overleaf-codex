import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HistoryStore } from "../bridge/history-store.mjs";

function conversation(id, updatedAt, text = id) {
  return {
    id,
    title: `Conversation ${id}`,
    createdAt: updatedAt,
    updatedAt,
    threadId: null,
    workspaceId: `workspace-${id}`,
    model: "model-a",
    effort: "medium",
    project: {
      projectId: "project-a",
      projectName: "Paper A",
      origin: "https://www.overleaf.com",
      workspaceId: "https://www.overleaf.com|project-a",
    },
    snapshot: {
      text: "Selected text.",
      from: 0,
      to: 14,
      documentLength: 14,
      filePath: "main.tex",
      fileName: "main.tex",
      lineStart: 3,
      lineEnd: 3,
      lineText: "Selected text.",
      viewAvailable: false,
    },
    selectionReferences: [
      {
        id: "reference-main",
        snapshot: {
          text: "Selected text.",
          from: 0,
          to: 14,
          documentLength: 14,
          filePath: "main.tex",
          fileName: "main.tex",
          lineStart: 3,
          lineEnd: 3,
          lineText: "Selected text.",
          viewAvailable: false,
        },
      },
    ],
    files: [
      {
        id: "0:main.tex",
        name: "main.tex",
        content: "\\section{Introduction}",
        length: 22,
        sha256: "A".repeat(64),
        editorIndex: 0,
        capturedAt: updatedAt,
      },
    ],
    messages: [
      {
        role: "user",
        text,
        at: updatedAt,
        references: [
          {
            id: "message-reference-main",
            name: "main.tex",
            relativePath: "main.tex",
            startLine: 3,
            endLine: 3,
          },
        ],
        files: [
          {
            id: "message-file-bib",
            name: "custom.bib",
            relativePath: "custom.bib",
          },
        ],
      },
    ],
  };
}

test("HistoryStore defaults to a dedicated Codex sessions directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new HistoryStore({
    stateDirectory: path.join(root, "state"),
    codexHome: path.join(root, "codex"),
  });

  assert.equal(
    store.getConfig().directory,
    path.join(root, "codex", "sessions", "overleaf-codex"),
  );
  store.save(conversation("one", 1));
  assert.equal(store.list()[0].id, "one");
  assert.equal(store.list()[0].workspaceId, "workspace-one");
  assert.deepEqual(store.list()[0].project, {
    projectId: "project-a",
    projectName: "Paper A",
    origin: "https://www.overleaf.com",
    workspaceId: "https://www.overleaf.com|project-a",
  });
  assert.equal(store.list()[0].files[0].name, "main.tex");
  assert.equal("content" in store.list()[0].files[0], false);
  assert.equal(store.list()[0].files[0].sha256, "a".repeat(64));
  assert.equal(store.list()[0].selectionReferences.length, 1);
  assert.deepEqual(store.list()[0].selectionReferences[0], {
    id: "reference-main",
    snapshot: {
      text: "Selected text.",
      from: 0,
      to: 14,
      documentLength: 14,
      contextBefore: "",
      contextAfter: "",
      anchorBefore: "",
      anchorAfter: "",
      editorIndex: 0,
      filePath: "main.tex",
      fileName: "main.tex",
      lineStart: 3,
      lineEnd: 3,
      lineText: "Selected text.",
      emptySelection: false,
      viewAvailable: false,
      rect: null,
    },
  });
  assert.deepEqual(store.list()[0].messages[0].references, [
    {
      id: "message-reference-main",
      name: "main.tex",
      relativePath: "main.tex",
      startLine: 3,
      endLine: 3,
    },
  ]);
  assert.deepEqual(store.list()[0].messages[0].files, [
    {
      id: "message-file-bib",
      name: "custom.bib",
      relativePath: "custom.bib",
    },
  ]);
  assert.ok(fs.existsSync(store.getConfig().filePath));
});

test("HistoryStore migrates existing history when the directory changes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new HistoryStore({
    stateDirectory: path.join(root, "state"),
    codexHome: path.join(root, "codex"),
  });
  store.save(conversation("one", 1));

  const customDirectory = path.join(root, "custom-history");
  const config = store.setDirectory(customDirectory);
  assert.equal(config.directory, customDirectory);
  assert.equal(store.list()[0].id, "one");
  assert.ok(fs.existsSync(path.join(customDirectory, "overleaf-codex-history.json")));
});

test("HistoryStore merges imports and keeps the newest conversation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new HistoryStore({
    stateDirectory: path.join(root, "state"),
    codexHome: path.join(root, "codex"),
  });
  store.save(conversation("same", 1, "old"));
  store.import([conversation("same", 2, "new"), conversation("other", 3)]);

  assert.deepEqual(
    store.list().map((item) => [item.id, item.messages[0].text]),
    [
      ["other", "other"],
      ["same", "new"],
    ],
  );
});

test("HistoryStore keeps many project conversations and supports explicit deletion", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-history-many-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new HistoryStore({
    stateDirectory: path.join(root, "state"),
    codexHome: path.join(root, "codex"),
  });
  const conversations = Array.from({ length: 125 }, (_, index) =>
    conversation(`item-${index}`, index + 1),
  );

  store.import(conversations);
  assert.equal(store.list().length, 125);
  assert.equal(store.list()[0].id, "item-124");

  const remaining = store.delete("item-62");
  assert.equal(remaining.length, 124);
  assert.equal(remaining.some((item) => item.id === "item-62"), false);
});
