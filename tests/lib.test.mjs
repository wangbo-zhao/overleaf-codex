import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSteerInput,
  buildTurnInput,
  DEVELOPER_INSTRUCTIONS,
  flattenPluginResponse,
  normalizeFileMentions,
  normalizeModels,
  parseStructuredResult,
  RESULT_SCHEMA,
} from "../bridge/lib.mjs";

test("developer instructions treat references as context instead of edit requests", () => {
  assert.doesNotMatch(DEVELOPER_INSTRUCTIONS, /inline writing collaborator/i);
  assert.match(
    DEVELOPER_INSTRUCTIONS,
    /A reference identifies context; it is not an instruction to rewrite/i,
  );
  assert.match(
    DEVELOPER_INSTRUCTIONS,
    /Only propose replacement text when the user explicitly asks to edit/i,
  );
  assert.match(
    DEVELOPER_INSTRUCTIONS,
    /questions, explanations, analysis, review, research/i,
  );
  assert.match(
    RESULT_SCHEMA.properties.replacements.description,
    /only when the user explicitly requested changes/i,
  );
});

test("parseStructuredResult accepts schema-conforming JSON", () => {
  assert.deepEqual(
    parseStructuredResult(
      JSON.stringify({
        message: "已润色。",
        replacement: "A clearer sentence.",
        replacements: [],
        warnings: ["Check the citation."],
      }),
    ),
    {
      message: "已润色。",
      replacement: "A clearer sentence.",
      replacements: [],
      warnings: ["Check the citation."],
    },
  );
});

test("parseStructuredResult degrades to a conversation-only response", () => {
  assert.deepEqual(parseStructuredResult("A plain response."), {
    message: "A plain response.",
    replacement: null,
    replacements: [],
    warnings: [],
  });
});

test("parseStructuredResult reports an empty Codex response", () => {
  assert.deepEqual(parseStructuredResult(""), {
    message: "Codex returned no text.",
    replacement: null,
    replacements: [],
    warnings: [],
  });
});

test("parseStructuredResult preserves every targeted replacement candidate", () => {
  assert.deepEqual(
    parseStructuredResult(
      JSON.stringify({
        message: "这里有三个版本。",
        replacement: null,
        replacements: [
          {
            text: "Balanced caption.",
            referenceIndex: 0,
            label: "平衡版",
          },
          {
            text: "Short caption.",
            referenceIndex: 0,
            label: " 精简版 ",
          },
          {
            text: "Second passage.",
            referenceIndex: 1,
            label: null,
          },
          {
            text: "Ignored invalid target.",
            referenceIndex: -1,
            label: "invalid",
          },
        ],
        warnings: [],
      }),
    ),
    {
      message: "这里有三个版本。",
      replacement: null,
      replacements: [
        {
          text: "Balanced caption.",
          referenceIndex: 0,
          label: "平衡版",
        },
        {
          text: "Short caption.",
          referenceIndex: 0,
          label: "精简版",
        },
        {
          text: "Second passage.",
          referenceIndex: 1,
          label: null,
        },
      ],
      warnings: [],
    },
  );
});

test("flattenPluginResponse only exposes installed enabled plugins", () => {
  const plugins = flattenPluginResponse({
    marketplaces: [
      {
        name: "personal",
        path: "/tmp/marketplace.json",
        plugins: [
          {
            id: "enabled",
            name: "zotero",
            installed: true,
            enabled: true,
            interface: {
              displayName: "Zotero",
              shortDescription: "Search the local library.",
              capabilities: ["search"],
            },
            source: { type: "local", path: "/tmp/zotero" },
          },
          {
            id: "disabled",
            name: "disabled",
            installed: true,
            enabled: false,
            source: { type: "local", path: "/tmp/disabled" },
          },
        ],
      },
    ],
  });

  assert.equal(plugins.length, 1);
  assert.equal(plugins[0].displayName, "Zotero");
  assert.equal(plugins[0].marketplaceName, "personal");
});

test("buildTurnInput attaches enabled selected plugin skills", () => {
  const input = buildTurnInput({
    message: "Use my library and rewrite this.",
    selection: "Original text.",
    contextBefore: "Before.",
    contextAfter: "After.",
    history: [
      { role: "user", text: "What is wrong with this sentence?" },
      { role: "assistant", text: "The verb does not agree with the subject." },
    ],
    selectedPlugins: [{ name: "zotero", displayName: "Zotero" }],
    pluginDetails: [
      {
        skills: [
          { name: "paper-search", enabled: true, path: "/plugins/zotero/paper-search/SKILL.md" },
          { name: "disabled", enabled: false, path: "/plugins/zotero/disabled/SKILL.md" },
        ],
      },
    ],
  });

  assert.equal(input[0].type, "text");
  assert.match(input[0].text, /Original text/);
  assert.match(input[0].text, /resumed local conversation/);
  assert.match(input[0].text, /does not agree/);
  assert.deepEqual(input[1], {
    type: "skill",
    name: "paper-search",
    path: "/plugins/zotero/paper-search/SKILL.md",
  });
  assert.equal(input.length, 2);
});

test("buildTurnInput references mirrored Overleaf files with Codex mentions", () => {
  const input = buildTurnInput({
    message: "Summarize the current file.",
    selection: "",
    files: [
      {
        name: "main.tex",
        path: "/tmp/overleaf-workspace/main.tex",
        length: 1234,
      },
    ],
  });

  assert.match(input[0].text, /main\.tex/);
  assert.doesNotMatch(input[0].text, /documentclass/);
  assert.deepEqual(input[1], {
    type: "mention",
    name: "main.tex",
    path: "/tmp/overleaf-workspace/main.tex",
  });
  assert.deepEqual(normalizeFileMentions([{ name: "main.tex", path: input[1].path }]), [
    {
      name: "main.tex",
      path: "/tmp/overleaf-workspace/main.tex",
      length: null,
    },
  ]);
});

test("buildTurnInput describes a complete synchronized project without enumerating files", () => {
  const input = buildTurnInput({
    message: "Inspect the project structure.",
    selection: "",
    project: {
      projectName: "Conference Paper",
      fileCount: 42,
      historyVersion: "123",
      syncedAt: 456,
    },
  });

  assert.equal(input.length, 1);
  assert.match(input[0].text, /complete, freshly synchronized Overleaf project/);
  assert.match(input[0].text, /Conference Paper/);
  assert.match(input[0].text, /"fileCount":42/);
});

test("buildTurnInput uses a synchronized file and line range instead of duplicating selected text", () => {
  const input = buildTurnInput({
    message: "Explain this derivation.",
    selection: "This raw selected text must stay in the browser.",
    contextBefore: "Private surrounding text.",
    contextAfter: "More private surrounding text.",
    selectionReference: {
      name: "method.tex",
      relativePath: "sections/method.tex",
      startLine: 8,
      endLine: 13,
    },
    files: [
      {
        name: "sections/method.tex",
        path: "/tmp/overleaf-workspace/sections/method.tex",
        length: 321,
      },
    ],
  });

  assert.match(input[0].text, /"file":"sections\/method\.tex"/);
  assert.match(input[0].text, /"startLine":8/);
  assert.match(input[0].text, /"endLine":13/);
  assert.doesNotMatch(input[0].text, /raw selected text/);
  assert.doesNotMatch(input[0].text, /Private surrounding text/);
  assert.deepEqual(input[1], {
    type: "mention",
    name: "sections/method.tex",
    path: "/tmp/overleaf-workspace/sections/method.tex",
  });
});

test("buildSteerInput carries the latest synchronized file-range reference", () => {
  const input = buildSteerInput({
    message: "Keep the equation unchanged.",
    selectionReference: {
      relativePath: "sections/method.tex",
      name: "method.tex",
      startLine: 8,
      endLine: 13,
    },
    files: [
      {
        name: "sections/method.tex",
        path: "/tmp/latest-project/sections/method.tex",
      },
    ],
  });

  assert.match(input[0].text, /^Keep the equation unchanged\./);
  assert.match(input[0].text, /"file":"sections\/method\.tex"/);
  assert.match(input[0].text, /"startLine":8/);
  assert.deepEqual(input[1], {
    type: "mention",
    name: "sections/method.tex",
    path: "/tmp/latest-project/sections/method.tex",
  });
});

test("buildTurnInput carries multiple file ranges without duplicating their raw text", () => {
  const input = buildTurnInput({
    message: "Compare the two claims.",
    selection: "",
    selectionReferences: [
      {
        relativePath: "main.tex",
        startLine: 2,
        endLine: 4,
        text: "Raw main selection.",
      },
      {
        relativePath: "sections/results.tex",
        startLine: 30,
        endLine: 34,
        text: "Raw results selection.",
      },
    ],
    files: [
      { name: "main.tex", path: "/tmp/project/main.tex" },
      {
        name: "sections/results.tex",
        path: "/tmp/project/sections/results.tex",
      },
    ],
  });

  assert.match(input[0].text, /"file":"main\.tex"/);
  assert.match(input[0].text, /"file":"sections\/results\.tex"/);
  assert.doesNotMatch(input[0].text, /Raw main selection/);
  assert.doesNotMatch(input[0].text, /Raw results selection/);
  assert.equal(input.filter((item) => item.type === "mention").length, 2);
});

test("buildSteerInput supports mixed file and raw-text references", () => {
  const input = buildSteerInput({
    message: "Use both contexts.",
    selectionReferences: [
      {
        relativePath: "main.tex",
        startLine: 5,
        endLine: 5,
      },
      {
        text: "Fallback browser selection.",
        contextBefore: "Before.",
        contextAfter: "After.",
      },
    ],
    files: [{ name: "main.tex", path: "/tmp/project/main.tex" }],
  });

  assert.match(input[0].text, /"file":"main\.tex"/);
  assert.match(input[0].text, /Fallback browser selection/);
  assert.equal(input[1].type, "mention");
});

test("normalizeModels exposes visible models and valid reasoning efforts", () => {
  const models = normalizeModels([
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
    {
      id: "hidden",
      model: "hidden",
      displayName: "Hidden",
      hidden: true,
      supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }],
    },
  ]);

  assert.deepEqual(models, [
    {
      id: "model-a",
      model: "model-a",
      displayName: "Model A",
      description: "Test model",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "medium", description: "Balanced" },
      ],
    },
  ]);
});
