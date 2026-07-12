# Module Map

This is a quick lookup map for `src/main/helpers/main`.

> The main process was reorganized: IPC registrars now live in `src/main/ipc/` (not in this folder), and `main.js` is a thin entry that defers to `src/main/core/main-services.js`. Many former single files are now folders.

## Legend

- `Main path`: directly involved in app boot or persistence
- `Support`: helper used by a main-path file
- `Specialized`: domain-specific subsystem with its own internal workflow

## Data persistence — `data/`

| File | Status | Notes |
| --- | --- | --- |
| `data/data-helpers.js` | Main path | `createMainDataHelpers(...)` — facade for selected/auto save and load |
| `data/data-snapshot-utils.js` | Support | builds the compact snapshot written to disk |
| `data/value-utils.js` | Support | value normalization helpers for snapshots |

## Storage bundles — `storage-bundle/`

Sidecar-path derivation, bundle sync, hydration, storage-root import, and SQLite read/write.

| File | Status | Notes |
| --- | --- | --- |
| `storage-bundle/index.js` | Main path | re-export surface: `getBundlePaths`, `syncBundleFromSnapshot`, `hydrateSnapshotFromBundle`, `importStorageRoot`, `discoverPapersFromStorageRoot`, workflow-root sync |
| `storage-bundle/storage-paths.js` | Support | sidecar/bundle path derivation |
| `storage-bundle/storage-sidecars.js` | Support | sidecar JSON read/write |
| `storage-bundle/storage-manifest.js` | Support | manifest generation (`STORAGE_MANIFEST_FILE_NAME`) |
| `storage-bundle/storage-memory.js` | Support | in-memory bundle state |
| `storage-bundle/storage-hydration.js` | Main path | snapshot hydration from a bundle |
| `storage-bundle/storage-import.js` | Main path | storage-root import |
| `storage-bundle/storage-sql-read.js` / `storage-sql-write.js` / `storage-sql-schema.js` | Support | SQLite bundle persistence |
| `storage-bundle/storage-utils.js` | Support | shared bundle helpers |
| `storage-bundle/workflow-storage.js` | Support | workflow-root sync/import |
| `storage-bundle/paper-discovery.js` | Support | discover papers under the storage root |
| `storage-bundle/sequence-library-summary.js` | Support | summarizes the sequence library for bundles |

## Sequence library — `sequence-library/` and `sequence/`

The biology-specific local library: SQLite/file storage, entry CRUD, feature search, annotation, alignment, and backbone recognition. Now split into ~22 focused modules.

| File | Status | Notes |
| --- | --- | --- |
| `sequence-library/index.js` | Specialized | public API: `listSequenceEntries`, `getSequenceEntry`, `upsertSequenceEntry`, `promoteSequenceEntry`, `deleteSequenceEntry`, `annotateSequenceRecord`, `searchSequenceFeatures`, `recognizeSequenceBackbone`, ... |
| `sequence-library/database.js`, `paths.js`, `constants.js` | Support | SQLite handle, library paths, status constants |
| `sequence-library/entry-read.js`, `entry-upsert.js` | Support | entry read and upsert |
| `sequence-library/feature-store.js`, `feature-search.js`, `feature-normalize.js` | Support | feature persistence and search |
| `sequence-library/annotation-service.js`, `annotation-candidates.js`, `annotation-matches.js` | Support | annotation matching pipeline |
| `sequence-library/alignment-store.js`, `alignment-normalize.js` | Support | alignment persistence |
| `sequence-library/backbone-service.js`, `recognized-service.js`, `recognized-store.js`, `recognized-utils.js` | Support | backbone recognition and recognized-store CRUD |
| `sequence-library/orf-scanner.js`, `protein-utils.js`, `sequence-geometry.js`, `utils.js` | Support | ORF scanning and sequence math |
| `sequence/sequence-library.js` | Specialized | compatibility entry into the library API |
| `sequence/sequence-backbone-recognition.js` | Specialized | heuristic backbone/insertion recognition |
| `sequence/circular-plasmid-annotation.js` | Support | circular plasmid annotation helpers |

## LLM runtime — `llm/`

| File | Status | Notes |
| --- | --- | --- |
| `llm/llm-provider-runtime.js` | Main path | provider request/response handling (OpenAI/Claude/Gemini/Chat Completions, PDF data URLs) |
| `llm/direct-llm-module-registry.js` | Support | registry of direct (non-agent) LLM modules |
| `llm/chat-log-transformer.js` | Support | chat-log transform runtime and folder monitor |

## Agent service wiring

| File | Status | Notes |
| --- | --- | --- |
| `create-main-agent-services.js` | Main path | builds the provider-neutral agent foundation (LLM bridge, tools, controllers) |
| `agent-mcp-initializer.js` | Support | initializes runtime configuration and official skills for the separate MCP service |

## PDF, paper, and chemical import

| File | Status | Notes |
| --- | --- | --- |
| `pdf-to-md.js` | Support | converts extracted PDF text to Markdown |
| `pdf-text-layout.js` | Support | PDF text-layout helpers (table-line detection, etc.) |
| `pdf-figure-extraction.js` | Support | extracts figures from PDFs |
| `paper-markdown-import.js` | Support | imports a paper PDF into Markdown via the PDF text-extraction runtime |
| `render-html-to-pdf.js` | Support | renders HTML to PDF (`renderHtmlToPdf`) |
| `chemical-import-parser.js` | Support | parses chemical-inventory import tables (incl. gzip) |

## Path utilities

| File | Status | Notes |
| --- | --- | --- |
| `app-paths.js` | Main path | `createMainAppPaths(...)` — userData/storage path resolution |
| `sqljs-path.js` | Support | locates the sql.js wasm asset across dev/packaged layouts |

## IPC (moved to `src/main/ipc/`)

IPC registration no longer lives in this folder. See [ipc-registrars.md](../ipc/ipc-registrars.md).

| File | Status | Notes |
| --- | --- | --- |
| `ipc/index.js` | Compatibility | retains the three-registrar aggregator; the main service catalog invokes each registrar directly |
| `ipc/register-data-ipc.js` | Main path | renderer data/storage/sequence endpoints |
| `ipc/register-system-ipc.js` | Main path | Codex CLI and Telegram configuration endpoints |
| `ipc/register-agent-ipc/` | Main path | agent IPC subsystem (chat handler, session/lifecycle services, intent dispatcher); runtime documented in [agent/](../../agent/README.md) |

## Good entry points

If you want to read the code after this doc set, start here:

1. `src/main/core/main-services.js` (service construction and IPC composition)
2. `src/main/ipc/register-data-ipc.js`
3. `src/main/helpers/main/data/data-helpers.js`
4. `src/main/helpers/main/storage-bundle/index.js`

Then move to `sequence-library/` only if you need the biology-specific library behavior.
