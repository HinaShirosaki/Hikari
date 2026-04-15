# storage-bundle

This folder contains the storage bundle/import pipeline that used to live in one `storage-bundle.js` file.

## Why this exists

The original file mixed together several separate concerns:

- bundle path derivation
- generic storage helpers
- SQLite schema, reads, and writes
- sidecar file generation
- snapshot hydration
- storage-root import and merge logic
- manifest generation
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
  - Protocol folder/notebook sidecar writers and `syncBundleFromSnapshot`.
- `storage-hydration.js`
  - Snapshot hydration from protocol folders, notebook sidecars, SQLite fallback data, and legacy protocol sidecars.
- `storage-import.js`
  - Storage-root import flow, merge helpers, bundle summarization, and manifest writing.
- `storage-manifest.js`
  - Manifest constants, file-role detection, discovered-file collection, and snapshot summary helpers.
- `sequence-library-summary.js`
  - Sequence library aggregation used during storage import.

## Compatibility

- `src/main/helpers/main/storage-bundle.js` remains as a thin wrapper so existing `require('./storage-bundle')` call sites do not need to change.
- The public exports remain the same:
  - `STORAGE_MANIFEST_FILE_NAME`
  - `getBundlePaths`
  - `syncBundleFromSnapshot`
  - `hydrateSnapshotFromBundle`
  - `importStorageRoot`
