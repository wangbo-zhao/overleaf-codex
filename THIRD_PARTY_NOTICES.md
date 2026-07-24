# Third-party notices

Overleaf Codex uses the following open-source packages:

| Package | Purpose | License |
| --- | --- | --- |
| [KaTeX](https://katex.org/) | Local math rendering and fonts in the Chrome extension | MIT |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Local Markdown rendering in the Chrome extension | MIT |
| [fflate](https://github.com/101arrowz/fflate) | ZIP creation for the cross-platform packaging script | MIT |

Complete license texts are stored under `third_party/licenses/`. KaTeX and
markdown-it license texts are also copied into `extension/vendor/` during
`npm ci` so they are included in the packaged browser extension.
