# Contracts Suite

This folder holds the large core contract tests split by concern.

- `ui-and-layout-contracts.js`: renderer, HTML, navigation, and UI wiring contracts.
- `storage-and-import-contracts.js`: bundle hydration, storage import, sqlite, and workflow storage contracts.
- `agent-contracts-a.js`: agent registrar, controller, logging, research, and tool wiring contracts.
- `agent-contracts-b.js`: reusable helper/runtime exports and runtime registry contracts.
- `agent-sequence-library-contracts.js`: sequence library storage, search, promotion, and backbone recognition contracts.
- `telegram-and-manifest-contracts.js`: Telegram bot internals, package manifest, and DOM id coverage checks.
- `index.js`: thin entry point used by the core suite loader.

Maintenance notes:

- Add new tests to the closest concern file instead of growing one catch-all suite.
- Keep helper path setup local to each file so the tests stay independent.
- If a file starts drifting above ~500 lines, split it again by narrower subsystem.
