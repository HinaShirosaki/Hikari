# Storage

This folder contains the storage bundle/import pipeline that used to live in one `storage-bundle.js` file.

## Why this exists

The original file mixed together several separate concerns:

- bundle path derivation
- generic storage helpers
- SQLite schema, reads, and writes
- sidecar file generation
- snapshot hydration
- storage-root import and merge logic
- sequence library summary

Splitting those pieces makes the storage pipeline easier to navigate and safer to extend.

## Module map

- `index.js`
  - Public entry point used by the rest of the app.
- `storage-paths.js`
  - Data-file suffix handling, supported extension checks, path resolution, and `getBundlePaths`.
- `storage-utils.js`
  - Generic helpers such as `cleanText`, `ensureObject`, `asArray`, JSON parsing, file reads, and shared SQL.js loading.
- `storage-sql-schema.js`
  - SQLite schema creation via `applySqliteSchema`.
- `storage-sql-write.js`
  - SQLite bundle index writers for inventory, protocols, notebook rows, record rows, and metadata.
- `storage-sql-read.js`
  - SQLite read helpers and row-to-snapshot fallback readers.
- `storage-sidecars.js`
  - Protocol folder, notebook page folder, sample JSON, and SQLite writers used by `syncBundleFromSnapshot`. Agent-owned workspace skill release is supplied by the main composition root instead of imported here.
- `storage-hydration.js`
  - Snapshot hydration from protocol folders, notebook folders, sample JSON, SQLite fallback data, and legacy sidecars.
- `storage-import.js`
  - Storage-root import flow (serialised), merge helpers, bundle summarization, and folder recognition.
- `storage-discovery.js`
  - Snapshot/bundle candidate detection (`isBundleCandidateName`, `looksLikeHikariSnapshot`) and per-bundle summaries. Skips the `hikari-storage-manifest.json` older builds left behind.
- `sequence-library-summary.js`
  - Sequence library aggregation used during storage import.

## Public API

- `index.js` is the canonical package entry. Node callers may require either the folder or `index.js`.
- The public exports are:
  - `getBundlePaths`
  - `syncBundleFromSnapshot`
  - `hydrateSnapshotFromBundle`
  - `importStorageRoot`

Production callers use the decorated `syncBundleFromSnapshot` assembled in
`src/main/core/main-services.js`. Narrow storage tests may inject
`releaseOfficialMcpSkillsForWorkspace` explicitly when they need to verify
Codex skill sidecars.
