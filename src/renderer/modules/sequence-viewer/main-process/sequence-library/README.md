# Sequence Library Storage

This folder owns the main-process Sequence Viewer storage implementation: SQLite setup, library entry persistence, alignments, feature search, annotations, and recognized-backbone artifact storage.

`index.js` is the only main-process entrypoint. Main service composition imports it from `src/renderer/modules/sequence-viewer/main-process/sequence-library`; renderer callers reach it through the sequence-library IPC and preload APIs.

Implementation files are intentionally kept around 200 lines or less and grouped by storage concern: entries, alignments, database setup, annotations, feature storage, and recognized backbones.

Keep pure Sequence Viewer matching and recognition algorithms under the sibling `algorithms/` folder.
