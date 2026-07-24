import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "extension", "vendor");
const katexSource = path.join(root, "node_modules", "katex", "dist");
const katexLicense = path.join(root, "node_modules", "katex", "LICENSE");
const markdownSource = path.join(
  root,
  "node_modules",
  "markdown-it",
  "dist",
  "markdown-it.min.js",
);
const markdownLicense = path.join(
  root,
  "node_modules",
  "markdown-it",
  "LICENSE",
);

for (const required of [
  path.join(katexSource, "katex.min.js"),
  path.join(katexSource, "katex.min.css"),
  path.join(katexSource, "fonts"),
  katexLicense,
  markdownSource,
  markdownLicense,
]) {
  if (!fs.existsSync(required)) {
    throw new Error(`Missing extension rendering dependency: ${required}`);
  }
}

const katexTarget = path.join(vendor, "katex");
const markdownTarget = path.join(vendor, "markdown-it");
fs.mkdirSync(katexTarget, { recursive: true });
fs.mkdirSync(markdownTarget, { recursive: true });
fs.copyFileSync(
  path.join(katexSource, "katex.min.js"),
  path.join(katexTarget, "katex.min.js"),
);
fs.copyFileSync(
  path.join(katexSource, "katex.min.css"),
  path.join(katexTarget, "katex.min.css"),
);
fs.cpSync(path.join(katexSource, "fonts"), path.join(katexTarget, "fonts"), {
  recursive: true,
  force: true,
});
fs.copyFileSync(katexLicense, path.join(katexTarget, "LICENSE"));
fs.copyFileSync(markdownSource, path.join(markdownTarget, "markdown-it.min.js"));
fs.copyFileSync(markdownLicense, path.join(markdownTarget, "LICENSE"));

console.log("Prepared local Markdown and KaTeX extension assets.");
