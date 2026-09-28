# Sequence Library Storage

This folder owns the main-process Sequence Viewer storage implementation: SQLite setup, library entry persistence, alignments, feature search, annotations, and recognized-backbone artifact storage.

`index.js` is the only main-process entrypoint. Main service composition imports it from `src/renderer/modules/sequence-viewer/main-process/sequence-library`; renderer callers reach it through the sequence-library IPC and preload APIs.

Implementation files are kept small (most under ~250 lines) and grouped by storage concern: entries (`entry-*.js`, `stored-record-read.js`), folders (`folder-store.js`), alignments (`alignment-*.js`), database setup (`database.js`, `paths.js`), annotations (`annotation-*.js`, `orf-scanner.js`), feature storage and search (`feature-*.js`), and recognized backbones (`recognized-*.js`, `backbone-service.js`). `operation-lock.js` serialises every reconciling read and write, including those from Hikari MCP server processes, because sql.js holds the whole database image in memory.

Keep pure Sequence Viewer matching and recognition algorithms under the sibling `algorithms/` folder.
