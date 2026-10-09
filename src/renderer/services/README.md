# Renderer Services

This folder is the cross-feature integration boundary. Registry services fan events between feature APIs, while platform-level adapters such as `direct-llm.js` coordinate capabilities shared across features.

- Fan-out services built by `index.js` (`createRendererServices`): `protocolService.js`, `notebookService.js`, `projectService.js`, `inventoryService.js`, `analysisService.js` (plus the feature-owned `modules/sequence-viewer/service.js`).
- Created by the renderer core: `module-registry.js`, `undoService.js` (shared controls over module-owned histories around `persist()`, with record/field patches in `history-patches.js`), and `unsavedChangesService.js` (the quit-time dialog).
- Shared adapters: `direct-llm.js`, `notebook-note-tools.js` (LLM-clarified notes), `notebook-page-log.js` (append-only `page.log`), and `notebook-record-compat.js` (persisted Sequence Viewer cloning records inside notebook entries).

Pure helpers belong in `renderer/lib/`. Feature-specific behavior belongs under `renderer/modules/<feature>/`. The full service table is in [docs/renderer/architecture/state-services-and-search.md](../../../docs/renderer/architecture/state-services-and-search.md).
