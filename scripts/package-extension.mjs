import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDirectory = path.join(root, "extension");
const outputDirectory = path.join(root, "dist");
const outputPath = path.join(outputDirectory, "overleaf-codex-extension.zip");
const files = {};

collectFiles(extensionDirectory);
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, zipSync(files, { level: 9 }));

console.log(
  `Packaged ${Object.keys(files).length} files to ${path.relative(root, outputPath)}.`,
);

function collectFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absolutePath);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = path
      .relative(extensionDirectory, absolutePath)
      .split(path.sep)
      .join("/");
    files[relativePath] = new Uint8Array(fs.readFileSync(absolutePath));
  }
}
