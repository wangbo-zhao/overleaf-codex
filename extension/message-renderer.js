(() => {
  const MarkdownIt = globalThis.markdownit;
  const markdown =
    typeof MarkdownIt === "function"
      ? MarkdownIt({
          html: false,
          linkify: true,
          breaks: false,
          typographer: false,
        })
      : null;

  if (markdown) {
    installMathRules(markdown);
    const defaultLinkOpen =
      markdown.renderer.rules.link_open ||
      ((tokens, index, options, environment, renderer) =>
        renderer.renderToken(tokens, index, options));
    markdown.renderer.rules.link_open = (
      tokens,
      index,
      options,
      environment,
      renderer,
    ) => {
      tokens[index].attrSet("target", "_blank");
      tokens[index].attrSet("rel", "noreferrer noopener");
      return defaultLinkOpen(tokens, index, options, environment, renderer);
    };
  }

  function renderToHtml(value) {
    const text = String(value ?? "");
    if (!markdown) return escapeHtml(text).replaceAll("\n", "<br>");
    return markdown.render(text);
  }

  function renderInto(element, value) {
    if (!element) return;
    if (!markdown) {
      element.textContent = String(value ?? "");
      return;
    }
    element.innerHTML = renderToHtml(value);
    for (const placeholder of element.querySelectorAll("[data-codex-math]")) {
      const source = decodeMath(placeholder.dataset.codexMath);
      const displayMode = placeholder.dataset.display === "true";
      if (!globalThis.katex?.render) {
        placeholder.textContent = displayMode ? `$$${source}$$` : `$${source}$`;
        continue;
      }
      globalThis.katex.render(source, placeholder, {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml",
      });
    }
  }

  function installMathRules(instance) {
    instance.inline.ruler.before("escape", "codex_math_inline", mathInlineRule);
    instance.block.ruler.before("fence", "codex_math_block", mathBlockRule, {
      alt: ["paragraph", "reference", "blockquote", "list"],
    });
    instance.renderer.rules.codex_math_inline = (tokens, index) =>
      mathPlaceholder(tokens[index].content, Boolean(tokens[index].meta?.display));
    instance.renderer.rules.codex_math_block = (tokens, index) =>
      `${mathPlaceholder(tokens[index].content, true)}\n`;
  }

  function mathInlineRule(state, silent) {
    const start = state.pos;
    const source = state.src;
    if (isEscaped(source, start)) return false;

    let open;
    let close;
    let display = false;
    if (source.startsWith("\\(", start)) {
      open = "\\(";
      close = "\\)";
    } else if (source.startsWith("\\[", start)) {
      open = "\\[";
      close = "\\]";
      display = true;
    } else if (source.startsWith("$$", start)) {
      open = "$$";
      close = "$$";
      display = true;
    } else if (source[start] === "$" && source[start + 1] !== "$") {
      open = "$";
      close = "$";
    } else {
      return false;
    }

    const contentStart = start + open.length;
    if (open === "$" && /\s/.test(source[contentStart] || "")) return false;
    const end = findClosingDelimiter(source, close, contentStart);
    if (end < 0 || end === contentStart) return false;
    if (open === "$" && /\s/.test(source[end - 1] || "")) return false;

    if (!silent) {
      const token = state.push("codex_math_inline", "math", 0);
      token.content = source.slice(contentStart, end);
      token.meta = { display };
    }
    state.pos = end + close.length;
    return true;
  }

  function mathBlockRule(state, startLine, endLine, silent) {
    const firstLine = lineText(state, startLine).trim();
    let open;
    let close;
    if (firstLine.startsWith("$$")) {
      open = "$$";
      close = "$$";
    } else if (firstLine.startsWith("\\[")) {
      open = "\\[";
      close = "\\]";
    } else {
      return false;
    }

    const firstContent = firstLine.slice(open.length);
    const sameLineEnd = findClosingDelimiter(firstContent, close, 0);
    let content;
    let nextLine;
    if (sameLineEnd >= 0) {
      if (firstContent.slice(sameLineEnd + close.length).trim()) return false;
      content = firstContent.slice(0, sameLineEnd);
      nextLine = startLine + 1;
    } else {
      const lines = [firstContent];
      nextLine = startLine + 1;
      let found = false;
      while (nextLine < endLine) {
        const current = lineText(state, nextLine);
        const closingIndex = findClosingDelimiter(current, close, 0);
        if (closingIndex >= 0) {
          if (current.slice(closingIndex + close.length).trim()) return false;
          lines.push(current.slice(0, closingIndex));
          nextLine += 1;
          found = true;
          break;
        }
        lines.push(current);
        nextLine += 1;
      }
      if (!found) return false;
      content = lines.join("\n");
    }

    if (silent) return true;
    const token = state.push("codex_math_block", "math", 0);
    token.block = true;
    token.content = content.trim();
    token.map = [startLine, nextLine];
    state.line = nextLine;
    return true;
  }

  function lineText(state, line) {
    const start = state.bMarks[line] + state.tShift[line];
    return state.src.slice(start, state.eMarks[line]);
  }

  function findClosingDelimiter(source, delimiter, from) {
    let cursor = from;
    while (cursor < source.length) {
      const index = source.indexOf(delimiter, cursor);
      if (index < 0) return -1;
      if (!isEscaped(source, index)) return index;
      cursor = index + delimiter.length;
    }
    return -1;
  }

  function isEscaped(source, index) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    return slashCount % 2 === 1;
  }

  function mathPlaceholder(source, display) {
    const encoded = encodeURIComponent(source);
    return `<span class="math-render${display ? " display" : ""}" data-codex-math="${encoded}" data-display="${display}"></span>`;
  }

  function decodeMath(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch {
      return String(value || "");
    }
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  globalThis.OverleafCodexMessageRenderer = {
    renderInto,
    renderToHtml,
  };
})();
