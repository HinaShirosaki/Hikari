# Protocols

`index.js` owns protocol CRUD/view composition and delegates focused behavior:

- generation and polish: `generation.js`, `polish.js`
- generated assistant records: `agent/` normalization, review payload collection, and approved-record persistence
- import: `import-controller.js`
- editing and draft normalization: `editor-utils.js`, `draft-utils.js`
- list/preview rendering: `list.js`, `preview.js`
- shared view wiring: `dom.js`, `constants.js`

Cross-feature print/PDF helpers stay under `renderer/modules/print/` and `pdf-export/`. Protocol creation runs through the shared Codex agent IPC/runtime so it can use web and literature tools; protocol polish remains a focused direct-LLM utility.
