# Papers

`index.js` composes the Papers workspace around a shared context.

- `pdf-viewer/`: PDF open/render/search/selection/navigation controllers and geometry helpers
- `library.js`: folder rail, list, and drag/drop behavior
- `comments.js`: anchored comments
- `actions.js`: storage and higher-level paper actions
- `llm.js`: direct LLM requests for paper workflows
- `model.js`, `normalizers.js`, `storage.js`: record and persistence support

Main-process search, download, parse, retrieval, and analysis code lives in `src/main/papers/`.
