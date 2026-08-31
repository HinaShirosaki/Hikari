# Contracts Suite

This folder holds the large core contract tests split by concern.

- `shell-and-packaging-contracts.js`: view/registry wiring, window CSP and sandbox flags, and packaging config.
- `storage-and-import-contracts.js`: bundle hydration, storage import, sqlite, and workflow storage contracts.
- `agent-contracts-a.js`: agent tool catalog contracts and the generic tool executor rule.
- `agent-contracts-b.js`: agent runtime behavior, MCP skill metadata, and tool action contracts.
- `agent-sequence-library-contracts.js`: sequence library storage, search, promotion, and backbone recognition contracts.
- `manifest-contracts.js`: the npm test gate wiring (DOM id coverage lives in `scripts/check-dom-ids.mjs`).
- `index.js`: thin entry point used by the core suite loader.

Maintenance notes:

- Add new tests to the closest concern file instead of growing one catch-all suite.
- Keep helper path setup local to each file so the tests stay independent.
- If a file starts drifting above ~500 lines, split it again by narrower subsystem.
