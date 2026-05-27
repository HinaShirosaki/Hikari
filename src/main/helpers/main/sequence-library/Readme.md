# Sequence Library Storage

This folder owns the main-process Sequence Viewer storage implementation: SQLite setup, library entry persistence, alignments, feature search, annotations, and recognized-backbone artifact storage.

The stable compatibility entry remains `src/main/helpers/main/sequence/sequence-library.js`, so existing main-runtime and tests can keep requiring the old path while this implementation is split away from algorithm adapters.

Implementation files are intentionally kept around 200 lines or less and grouped by storage concern: entries, alignments, database setup, annotations, feature storage, and recognized backbones.

Keep pure Sequence Viewer matching and recognition algorithms under `src/renderer/modules/sequence-viewer/algorithms/`.
