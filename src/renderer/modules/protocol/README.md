# Protocols

`index.js` owns protocol CRUD/view composition and delegates focused behavior:

- generation and polish: `generation.js`, `polish.js`
- generated assistant records: `agent/` normalization, review payload collection, and approved-record persistence
- import/share: `import-controller.js`, `sharing.js`
- editing and draft normalization: `editor-utils.js`, `draft-utils.js`
- list/preview rendering: `list.js`, `preview.js`
- shared view wiring: `dom.js`, `constants.js`

Cross-feature print/PDF helpers stay under `renderer/modules/print/` and `pdf-export/`; provider calls go through `renderer/services/direct-llm.js`.
