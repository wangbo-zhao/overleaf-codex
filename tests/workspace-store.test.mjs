import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { WorkspaceStore } from "../bridge/workspace-store.mjs";

test("WorkspaceStore mirrors Overleaf files and reuses metadata references", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-workspace-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new WorkspaceStore({ rootDirectory: root });

  const first = store.sync("conversation-1", [
    {
      id: "0:main.tex",
      name: "main.tex",
      content: "\\section{Introduction}\nHello.",
      editorIndex: 0,
      capturedAt: 10,
    },
  ]);
  assert.equal(first.files.length, 1);
  assert.equal(fs.readFileSync(first.files[0].path, "utf8"), "\\section{Introduction}\nHello.");
  assert.ok(first.files[0].path.startsWith(`${first.directory}${path.sep}`));
  assert.equal(first.files[0].changed, true);
  assert.match(first.files[0].sha256, /^[a-f0-9]{64}$/);

  const resumed = store.sync("conversation-1", [
    {
      id: "0:main.tex",
      name: "main.tex",
      length: first.files[0].length,
      editorIndex: 0,
      capturedAt: 10,
    },
  ]);
  assert.equal(resumed.files[0].path, first.files[0].path);
  assert.equal(resumed.files[0].changed, false);
  assert.equal(resumed.files[0].sha256, first.files[0].sha256);

  const unchanged = store.sync("conversation-1", [
    {
      id: "0:main.tex",
      name: "main.tex",
      content: "\\section{Introduction}\nHello.",
      editorIndex: 0,
      capturedAt: 20,
    },
  ]);
  assert.equal(unchanged.files[0].changed, false);

  const updated = store.sync("conversation-1", [
    {
      id: "0:main.tex",
      name: "main.tex",
      content: "\\section{Introduction}\nUpdated.",
      editorIndex: 0,
      capturedAt: 30,
    },
  ]);
  assert.equal(updated.files[0].changed, true);
  assert.notEqual(updated.files[0].sha256, first.files[0].sha256);
  assert.equal(
    fs.readFileSync(updated.files[0].path, "utf8"),
    "\\section{Introduction}\nUpdated.",
  );
});

test("WorkspaceStore removes detached files from its isolated mirror", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-workspace-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new WorkspaceStore({ rootDirectory: root });
  const synced = store.sync("conversation-2", [
    { id: "0:main.tex", name: "main.tex", content: "Main" },
    { id: "1:refs.bib", name: "refs.bib", content: "Refs" },
  ]);
  const detachedPath = synced.files[1].path;

  const next = store.sync("conversation-2", [
    { id: "0:main.tex", name: "main.tex", content: "Main" },
  ]);
  assert.equal(next.files.length, 1);
  assert.equal(fs.existsSync(detachedPath), false);
});

test("WorkspaceStore does not impose UI-level file count or character limits", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-workspace-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new WorkspaceStore({ rootDirectory: root });
  const files = Array.from({ length: 7 }, (_, index) => ({
    id: `${index}:chapter-${index}.tex`,
    name: `chapter-${index}.tex`,
    content: index === 0 ? "x".repeat(120_001) : `Chapter ${index}`,
  }));

  const synced = store.sync("large-conversation", files);
  assert.equal(synced.files.length, 7);
  assert.equal(synced.files[0].length, 120_001);
});

test("WorkspaceStore mirrors a complete Overleaf ZIP with stable paths and hashes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-project-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new WorkspaceStore({ rootDirectory: root });
  const workspaceId = "https://www.overleaf.com|project-1";
  const firstArchive = Buffer.from(
    zipSync({
      "main.tex": strToU8("\\input{sections/method}\n"),
      "sections/method.tex": strToU8("Initial method."),
      "figures/plot.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }),
  );

  const first = store.syncProject(workspaceId, firstArchive, {
    projectId: "project-1",
    projectName: "Paper",
    origin: "https://www.overleaf.com",
    historyVersion: "10",
  });
  assert.equal(first.project.fileCount, 3);
  assert.equal(first.changedCount, 3);
  assert.equal(first.deletedCount, 0);
  assert.equal(
    fs.readFileSync(path.join(first.directory, "sections/method.tex"), "utf8"),
    "Initial method.",
  );

  const opened = store.openProject(workspaceId);
  assert.equal(opened.directory, first.directory);
  assert.deepEqual(
    opened.files.map((file) => file.relativePath).sort(),
    ["figures/plot.png", "main.tex", "sections/method.tex"],
  );
  fs.writeFileSync(path.join(first.directory, "local-only.tmp"), "stale");

  const secondArchive = Buffer.from(
    zipSync({
      "main.tex": strToU8("\\input{sections/method}\n"),
      "sections/method.tex": strToU8("Updated method."),
    }),
  );
  const second = store.syncProject(workspaceId, secondArchive, {
    projectId: "project-1",
    projectName: "Paper",
    origin: "https://www.overleaf.com",
    historyVersion: "11",
  });
  assert.equal(second.changedCount, 1);
  assert.equal(second.deletedCount, 1);
  assert.equal(
    fs.readFileSync(path.join(second.directory, "sections/method.tex"), "utf8"),
    "Updated method.",
  );
  assert.equal(fs.existsSync(path.join(second.directory, "figures/plot.png")), false);
  assert.equal(fs.existsSync(path.join(second.directory, "local-only.tmp")), false);
});

test("WorkspaceStore rejects unsafe paths in an Overleaf ZIP", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-project-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new WorkspaceStore({ rootDirectory: root });
  const archive = Buffer.from(
    zipSync({
      "../outside.tex": strToU8("unsafe"),
    }),
  );

  assert.throws(
    () => store.syncProject("workspace", archive),
    /unsafe file path/,
  );
  assert.equal(fs.existsSync(path.join(root, "outside.tex")), false);
});

test("WorkspaceStore applies Overleaf history changes without replacing the project", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-incremental-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new WorkspaceStore({ rootDirectory: root });
  const workspaceId = "https://www.overleaf.com|project-incremental";
  const archive = Buffer.from(
    zipSync({
      "main.tex": strToU8("Hello world\n"),
      "sections/old.tex": strToU8("Old section.\n"),
      "figures/plot.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }),
  );
  store.syncProject(workspaceId, archive, {
    projectId: "project-incremental",
    projectName: "Incremental paper",
    origin: "https://www.overleaf.com",
    historyVersion: "10",
  });

  const section = Buffer.from("Section");
  const sectionHash = createHash("sha1").update(section).digest("hex");
  store.stageProjectBlob(workspaceId, sectionHash, section);
  const synced = store.syncProjectChanges(
    workspaceId,
    {
      fromVersion: 10,
      toVersion: 14,
      projectName: "Incremental paper",
      changes: [
        {
          timestamp: "2026-07-24T00:00:00.000Z",
          operations: [
            {
              pathname: "main.tex",
              textOperation: [6, -5, "Codex", 1],
            },
          ],
        },
        {
          timestamp: "2026-07-24T00:00:01.000Z",
          operations: [
            {
              pathname: "sections/new.tex",
              file: {
                hash: sectionHash,
                stringLength: 8,
                operations: [{ textOperation: [7, "!"] }],
              },
            },
          ],
        },
        {
          timestamp: "2026-07-24T00:00:02.000Z",
          operations: [
            {
              pathname: "figures/plot.png",
              newPathname: "figures/final.png",
            },
          ],
        },
        {
          timestamp: "2026-07-24T00:00:03.000Z",
          operations: [
            {
              pathname: "sections/old.tex",
              newPathname: "",
            },
          ],
        },
      ],
    },
    {
      projectId: "project-incremental",
      origin: "https://www.overleaf.com",
    },
  );

  assert.equal(synced.project.historyVersion, "14");
  assert.equal(synced.changedCount, 3);
  assert.equal(synced.deletedCount, 2);
  assert.equal(
    fs.readFileSync(path.join(synced.directory, "main.tex"), "utf8"),
    "Hello Codex\n",
  );
  assert.equal(
    fs.readFileSync(
      path.join(synced.directory, "sections/new.tex"),
      "utf8",
    ),
    "Section!",
  );
  assert.deepEqual(
    fs.readFileSync(path.join(synced.directory, "figures/final.png")),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  assert.equal(
    fs.existsSync(path.join(synced.directory, "figures/plot.png")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(synced.directory, "sections/old.tex")),
    false,
  );
  assert.deepEqual(store.getProjectState(workspaceId), {
    exists: true,
    workspaceId,
    project: synced.project,
    fileCount: 3,
  });
});

test("WorkspaceStore rejects a non-contiguous Overleaf history version", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-incremental-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new WorkspaceStore({ rootDirectory: root });
  const workspaceId = "https://www.overleaf.com|project-version";
  store.syncProject(
    workspaceId,
    Buffer.from(zipSync({ "main.tex": strToU8("Versioned.") })),
    { historyVersion: "20" },
  );

  const unchanged = store.syncProjectChanges(workspaceId, {
    fromVersion: 20,
    toVersion: 20,
    changes: [],
  });
  assert.equal(unchanged.changedCount, 0);
  assert.equal(unchanged.project.historyVersion, "20");

  assert.throws(
    () =>
      store.syncProjectChanges(workspaceId, {
        fromVersion: 19,
        toVersion: 19,
        changes: [],
      }),
    /版本不连续/,
  );
  assert.throws(
    () =>
      store.syncProjectChanges(workspaceId, {
        fromVersion: 20,
        toVersion: 21,
        changes: [
          {
            timestamp: "2026-07-24T00:00:00.000Z",
            operations: [{ pathname: "main.tex", replace: "unsafe" }],
          },
        ],
      }),
    /未知增量操作/,
  );
  assert.equal(store.getProjectState(workspaceId).project.historyVersion, "20");
});

test("WorkspaceStore persists a custom root and migrates existing mirrors", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "overleaf-workspace-config-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const stateDirectory = path.join(base, "state");
  const defaultDirectory = path.join(base, "default-workspaces");
  const customDirectory = path.join(base, "custom-workspaces");
  const workspaceId = "https://www.overleaf.com|project-config";
  const archive = Buffer.from(
    zipSync({
      "main.tex": strToU8("Configured workspace."),
    }),
  );

  const store = new WorkspaceStore({
    rootDirectory: defaultDirectory,
    stateDirectory,
  });
  assert.deepEqual(store.getConfig(), {
    directory: defaultDirectory,
    defaultDirectory,
    isDefault: true,
  });
  store.syncProject(workspaceId, archive);

  const configured = store.setDirectory(customDirectory);
  assert.equal(configured.directory, customDirectory);
  assert.equal(configured.migratedFrom, defaultDirectory);
  assert.equal(
    fs.readFileSync(
      path.join(store.openProject(workspaceId).directory, "main.tex"),
      "utf8",
    ),
    "Configured workspace.",
  );

  const restored = new WorkspaceStore({
    rootDirectory: defaultDirectory,
    stateDirectory,
  });
  assert.equal(restored.getConfig().directory, customDirectory);
  assert.equal(restored.getConfig().isDefault, false);

  const reset = restored.setDirectory("");
  assert.equal(reset.directory, defaultDirectory);
  assert.equal(reset.isDefault, true);
});
