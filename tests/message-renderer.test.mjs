import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererSource = fs.readFileSync(
  path.join(root, "extension", "message-renderer.js"),
  "utf8",
);

function renderer() {
  const context = vm.createContext({
    markdownit: (options) => new MarkdownIt(options),
    encodeURIComponent,
    decodeURIComponent,
  });
  vm.runInContext(rendererSource, context);
  return context.OverleafCodexMessageRenderer;
}

test("message renderer supports Markdown while escaping raw HTML", () => {
  const html = renderer().renderToHtml(
    "## Result\n\n1. **First** item\n2. `code`\n\n<script>alert(1)</script>",
  );

  assert.match(html, /<h2>Result<\/h2>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<strong>First<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("message renderer recognizes inline and display LaTeX delimiters", () => {
  const html = renderer().renderToHtml(
    String.raw`Use $\mathcal W$ and \(s_c^*\).

$$
B_{\mathrm a} + B_{\mathrm v}
$$`,
  );

  assert.match(html, /data-codex-math="%5Cmathcal%20W"/);
  assert.match(html, /data-codex-math="s_c%5E\*"/);
  assert.match(html, /class="math-render display"/);
  assert.match(html, /B_%7B%5Cmathrm%20a%7D/);
});

test("message renderer leaves math-looking text inside code spans untouched", () => {
  const html = renderer().renderToHtml("Keep `$x+y$` literal.");

  assert.match(html, /<code>\$x\+y\$<\/code>/);
  assert.doesNotMatch(html, /data-codex-math/);
});
