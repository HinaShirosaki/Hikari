# Science And Protocol Suite

This folder holds the remaining protocol-generation tests split by concern.

- `loop-runtime-edge-and-protocol-suite.js`: deterministic protocol normalization and prompt contracts (the filename is retained to avoid needless test-loader churn).
- `index.js`: thin composition entrypoint used by the parent agent suite.

Maintenance notes:

- Keep new tests near the subsystem they exercise rather than rebuilding a catch-all file.
- Prefer adding a new focused suite file if one grows past roughly 500 lines.
- Keep each file independent by reading helpers from `context.scope` instead of sharing local state across files.
