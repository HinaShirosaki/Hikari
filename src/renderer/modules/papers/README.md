# Papers

`index.js` composes the Papers workspace around a shared context.

- `pdf-viewer/`: PDF open/render/search/selection/navigation controllers and geometry helpers
- `library.js`, `library-events.js`, `library-folder-menu.js`: folder rail, list, uploads, renames, the folder context menu, and drag/drop behavior
- `comments.js`: anchored comments
- `actions.js`, `actions-upload.js`, `actions-analysis.js`: storage and higher-level paper actions, adding PDFs to the library, and summary/method extraction
- `research-brief.js`: loads the saved research brief beside the paper's knowledge files
- `workspace-controls.js`: coordinates the outline and the paper-scoped agent rail
- `agent-context.js`: what the agent rail reads for the open paper
- `management/`: discovery of stored PDFs, discovery merge, external links, and search text
- `llm.js`, `paper-prompts.json`: direct LLM requests for paper workflows and their prompts
- `model.js`, `normalizers.js`, `storage.js`, `pdf-metadata.js`: record and persistence support
- `pdfjs-compat.js`, `pdfjs-worker.js`: PDF.js compatibility shims and worker setup
- `locales/en.js`, `locales/es.js`, `localization.js`: the `papers` UI catalog, bound markup/notice helpers
  (`paperUi()` descriptors) and `relativePaperTimeMessage()`. Paper records, metadata,
  comments, search text, agent context and `movePaperToFolder()` errors stay canonical.
  The bundled Spanish preview has interaction checks in
  `tests/fixtures/i18n/papers-checks.mjs`. The hidden viewer status line keeps English progress text.

Main-process search, download, parse, retrieval, and analysis code lives in `src/main/papers/`.
