# Storage

This folder owns the storage-root layout: protocols and notebook prose live in Markdown with structured JSON companions, other records use their module-owned folders, and loading rebuilds the snapshot from those folders. It also keeps the chemicals SQLite index and imports existing roots. The full layout and save/load order are in [docs/main-platform/data/storage-and-bundles.md](../../../docs/main-platform/data/storage-and-bundles.md).

## Module map

- `index.js`
  - Public entry point used by the rest of the app.
- `storage-paths.js`
  - Root-folder names, `RECORD_FOLDERS` (assays, gels), data-file suffix handling, path resolution, and `getBundlePaths`.
- `storage-utils.js`
  - Generic helpers such as `cleanText`, `ensureObject`, `asArray`, JSON parsing, file reads, and shared SQL.js loading.
- `storage-sql-schema.js`
  - The chemicals index schema, the only save-time SQLite bundle.
- `storage-sql-write.js`
  - `writeChemicalSqliteBundleIndex`, rebuilding the chemicals index from the snapshot.
- `storage-sql-read.js`
  - Chemicals-index read helpers; an unusable index hydrates as empty with a warning.
- `chemical-index-guard.js`
  - Moves an unreadable chemicals index aside (`.corrupt-<time>`) and refuses chemical writes when it cannot, because the index is the only copy of the inventory.
- `storage-sidecars.js`
  - `syncBundleFromSnapshot`: protocol folders, notebook page folders, project memory, sample containers, the experiment log, assay/gel record folders, paper records beside PDFs, the chemicals index, and the workflow root. Agent-owned workspace skill release is supplied by the main composition root instead of imported here.
- `record-markdown/`
  - Migrates and saves readable `protocol.md` / `page.md`, including linked assay/gel context and file/image links. `document-storage.js` merges external prose edits, backs up legacy JSON, and stages a recoverable checkpoint before replacing Markdown and JSON. `preflight.js` rejects ambiguous destinations before a save writes anything; a record whose document is damaged or conflicting is skipped and reported in `skippedRecords` while the rest of the save continues. `rebuild.js` supports explicit migration and regeneration without touching indexes, creating missing legacy workflow metadata when needed for discovery.
  - The neutral reader is `main/lib/record-markdown/read.js`; the document codec is `shared/record-markdown/`. Storage hydration and project-memory validation use the same reader. Renderer autosaves use `services/markdown-record-storage.js` to carry document revisions and preserve save order.
- `storage-hydration.js` and `hydration/`
  - Snapshot hydration from protocol folders, project/notebook folders, sample containers, the experiment log, the workflow root, the chemicals index, paper records, assay/gel folders, and legacy `*.protocols.json` / `*.notebook-pages.json` files.
- `sample-containers.js`
  - `Samples/<zone>/<container>__<id>.json`, `folders.json`, and `unplaced.json`.
- `experiment-log-storage.js`
  - `Dashboard/experiment-log.json` (Home experiment log).
- `workflow-storage.js` and `workflow/`
  - `Workflow/` template and run folders, their notebook pages, and related papers.
- `paper-discovery.js`
  - Finds PDFs under the storage root and reads the `<file>.pdf.json` record beside each one.
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
  - `syncBundleFromSnapshot`, `syncSqliteBundleFromSnapshot`
  - `hydrateSnapshotFromBundle`
  - `importStorageRoot`
  - `discoverPapersFromStorageRoot`
  - `syncWorkflowRootFromSnapshot`, `hydrateWorkflowRootFromStoragePath`, `importWorkflowRoot`

Production callers use the decorated `syncBundleFromSnapshot` assembled in
`src/main/core/main-services.js`. Narrow storage tests may inject
`releaseOfficialMcpSkillsForWorkspace` explicitly when they need to verify
Codex skill sidecars.
