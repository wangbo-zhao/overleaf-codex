import assert from "node:assert/strict";
import test from "node:test";
import { resolveCodexCommand } from "../bridge/codex-app-server.mjs";

test("resolveCodexCommand finds codex on PATH", () => {
  const expected = "/custom/bin/codex";
  const resolved = resolveCodexCommand({
    env: { PATH: "/missing:/custom/bin" },
    platform: "darwin",
    homeDirectory: "/Users/example",
    isExecutable: (candidate) => candidate === expected,
  });

  assert.equal(resolved, expected);
});

test("resolveCodexCommand finds the Codex bundled with ChatGPT on macOS", () => {
  const expected = "/Applications/ChatGPT.app/Contents/Resources/codex";
  const resolved = resolveCodexCommand({
    env: { PATH: "" },
    platform: "darwin",
    homeDirectory: "/Users/example",
    isExecutable: (candidate) => candidate === expected,
  });

  assert.equal(resolved, expected);
});

test("resolveCodexCommand honors an explicit executable override", () => {
  const expected = "/custom/Codex Binary";
  const resolved = resolveCodexCommand({
    env: {
      PATH: "",
      OVERLEAF_CODEX_COMMAND: expected,
    },
    platform: "darwin",
    homeDirectory: "/Users/example",
    isExecutable: (candidate) => candidate === expected,
  });

  assert.equal(resolved, expected);
});

test("resolveCodexCommand reports an actionable override error", () => {
  assert.throws(
    () =>
      resolveCodexCommand({
        env: {
          PATH: "",
          OVERLEAF_CODEX_COMMAND: "/missing/codex",
        },
        platform: "darwin",
        homeDirectory: "/Users/example",
        isExecutable: () => false,
      }),
    /OVERLEAF_CODEX_COMMAND.*不可执行/,
  );
});
