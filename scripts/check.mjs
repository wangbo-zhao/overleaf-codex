import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const javascriptFiles = [
  "bridge/codex-app-server.mjs",
  "bridge/history-store.mjs",
  "bridge/workspace-store.mjs",
  "bridge/lib.mjs",
  "bridge/job-manager.mjs",
  "bridge/server.mjs",
  "extension/background.js",
  "extension/content.js",
  "extension/message-renderer.js",
  "extension/options.js",
  "scripts/package-extension.mjs",
  "scripts/prepare-extension-assets.mjs",
];

for (const relativePath of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"),
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
if (manifest.manifest_version !== 3) throw new Error("Chrome Manifest V3 is required.");
if (manifest.version !== packageJson.version) {
  throw new Error("package.json and extension/manifest.json versions must match.");
}
if (!manifest.permissions.includes("scripting")) throw new Error("Missing scripting permission.");
if (!manifest.content_scripts?.length) throw new Error("Missing Overleaf content script.");
if (
  manifest.commands?.["open-codex-dialog"]?.suggested_key?.mac !==
  "Command+Shift+K"
) {
  throw new Error("The Overleaf Codex open shortcut must default to Command+Shift+K.");
}
if (
  manifest.commands?.["add-selection-reference"]?.suggested_key?.mac !==
  "Command+Shift+I"
) {
  throw new Error("The selection reference shortcut must default to Command+Shift+I.");
}
for (const script of manifest.content_scripts[0].js || []) {
  if (!fs.existsSync(path.join(root, "extension", script))) {
    throw new Error(`Missing content script asset: ${script}`);
  }
}
const iconAssets = new Set([
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
]);
for (const icon of iconAssets) {
  if (!fs.existsSync(path.join(root, "extension", icon))) {
    throw new Error(`Missing extension icon asset: ${icon}`);
  }
}
for (const asset of [
  "extension/vendor/katex/katex.min.css",
  "extension/vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  "extension/vendor/katex/LICENSE",
  "extension/vendor/markdown-it/LICENSE",
]) {
  if (!fs.existsSync(path.join(root, asset))) {
    throw new Error(`Missing prepared extension asset: ${asset}`);
  }
}

const fixtureHtml = fs.readFileSync(
  path.join(root, "tests/fixtures/overleaf-mock.html"),
  "utf8",
);
for (const match of fixtureHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  // Parse inline fixture scripts without executing them.
  new Function(match[1]);
}

console.log("Syntax and manifest checks passed.");
