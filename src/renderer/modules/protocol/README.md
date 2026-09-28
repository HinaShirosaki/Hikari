# Protocols

`index.js` owns protocol CRUD/view composition and delegates focused behavior:

- generation and polish: `generation.js`, `polish.js`
- generated assistant records: `agent/` normalization, review payload collection, and approved-record persistence
- import: `import-controller.js`
- editing and draft normalization: `editor-utils.js`, `editor-actions.js` (placeholder insertion, submit, drafts from papers), `draft-utils.js`, `draft-import.js`
- interactive-bar presets above **Steps**: `placeholder-presets.js`
- list/preview rendering and the detail column (empty / editor / view, plus export, print, delete): `list.js`, `preview.js`, `detail-panels.js`
- shared view wiring: `dom.js`, `constants.js`

Cross-feature print/PDF helpers stay under `renderer/modules/print/` and `pdf-export/`. Protocol creation runs through the shared Codex agent IPC/runtime so it can use web and literature tools; protocol polish remains a focused direct-LLM utility.
