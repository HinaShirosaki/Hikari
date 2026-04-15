# Science And Protocol Suite

This folder holds the large science and protocol agent tests split by concern.

- `route-planning-suite.js`: route planning and exit-criteria generation contracts.
- `synthesis-and-verification-suite.js`: final synthesis and logical verification contracts.
- `prompt-and-fallback-suite.js`: prompt rendering and fallback heuristic contracts.
- `judge-and-trace-suite.js`: judge fallbacks, pre-synthesis helpers, and thinking-trace contracts.
- `loop-runtime-core-suite.js`: core multi-round science loop execution behavior.
- `loop-runtime-followup-suite.js`: clarification, reasoning-effort-0, and straightforward retrieval flow.
- `loop-runtime-edge-and-protocol-suite.js`: late-stage loop edge cases and protocol generation.
- `index.js`: thin composition entrypoint used by the parent agent suite.

Maintenance notes:

- Keep new tests near the subsystem they exercise rather than rebuilding a catch-all file.
- Prefer adding a new focused suite file if one grows past roughly 500 lines.
- Keep each file independent by reading helpers from `context.scope` instead of sharing local state across files.
