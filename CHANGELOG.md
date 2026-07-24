# Changelog

This project follows semantic versioning from the first stable release.

## 1.7.0

- Reduced the unchanged final-sync path to one history flush and one
  non-waiting version probe.
- Added validated project-state caching between pre-sync and final turn sync.
- Added edit-generation stabilization when Overleaf changes during final sync.
- Parallelized model/plugin metadata warm-up with project synchronization.
- Added standard Chrome extension icons.

## 1.6.0

- Added idle background pre-sync and an unchanged-project fast path.
- Made references neutral context instead of implicit rewrite requests.

## 1.5.0

- Replaced repeated full ZIP downloads with Overleaf history-based incremental
  synchronization and changed-blob transfer.

## 1.4.0

- Added persistent VS Code-style references to user messages.
- Added candidate return actions and centered candidate-card operations.

## 1.3.0

- Added multiple replacement candidates and per-reference grouping.

## 1.2.0

- Split open-chat and add-reference shortcuts.
- Added multiple file/line references.

## 1.1.0

- Added mirrored file mentions with project-relative line ranges.

## 1.0.0

- First stable release with project mirrors, Codex App Server sessions,
  project-grouped history, explicit Steer, Markdown/KaTeX rendering, and inline
  settings.

For older pre-1.0 development history, inspect repository tags and commits.
