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
| `storage-bundle/storage-sidecars.js` | Support | sidecar JSON read/write; agent-owned skill release is injected by `main-services.js` |
| `storage-bundle/storage-manifest.js` | Support | manifest generation (`STORAGE_MANIFEST_FILE_NAME`) |
| `storage-bundle/storage-memory.js` | Support | in-memory bundle state |
| `storage-bundle/storage-hydration.js` | Main path | snapshot hydration from a bundle |
| `storage-bundle/storage-import.js` | Main path | storage-root import |
| `storage-bundle/storage-sql-read.js` / `storage-sql-write.js` / `storage-sql-schema.js` | Support | SQLite bundle persistence |
| `storage-bundle/storage-utils.js` | Support | shared bundle helpers |
| `storage-bundle/workflow-storage.js` | Support | workflow-root sync/import |
| `storage-bundle/paper-discovery.js` | Support | discover papers under the storage root |
| `storage-bundle/sequence-library-summary.js` | Support | summarizes the sequence library for bundles |

## Sequence Viewer library — moved out of generic helpers

The biology-specific local library is owned by `src/renderer/modules/sequence-viewer/main-process/sequence-library/`, inside the existing Sequence Viewer feature. Its `index.js` is the only public Node entrypoint; generic helpers no longer provide a sequence compatibility package.

See [Sequence library](../sequences/sequence-library.md) and `src/renderer/modules/sequence-viewer/main-process/README.md` for the storage, search, annotation, alignment, and backbone-recognition map.

## LLM runtime — `llm/`

| File | Status | Notes |
| --- | --- | --- |
| `llm/llm-provider-runtime.js` | Main path | provider request/response handling (OpenAI/Claude/Gemini/Chat Completions, PDF data URLs) |
| `llm/direct-llm-module-registry.js` | Support | registry of direct (non-agent) LLM modules |
| `llm/chat-log-transformer.js` | Support | chat-log transform runtime and folder monitor |

## Agent service wiring

| File | Status | Notes |
| --- | --- | --- |
| `src/main/core/services/create-agent-services.js` | Main path | composition root for the provider-neutral agent foundation (LLM bridge, tools, controllers) |
| `src/main/core/services/create-agent-mcp-initializer.js` | Main path | composes runtime configuration and official skill release for the MCP service |

## Paper and chemical import

| File | Status | Notes |
| --- | --- | --- |
| `src/main/papers/parse/` | Specialized | PDF text extraction, layout cleanup, figure extraction, Markdown conversion, and paper import |
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
| `ipc/register-data-ipc.js` | Main path | renderer data/storage/import composition |
| `ipc/register-data-ipc/register-sequence-library-ipc.js` | Main path | grouped Sequence Viewer IPC endpoints |
| `ipc/register-system-ipc.js` | Main path | Codex CLI and Telegram configuration endpoints |
| `ipc/register-agent-ipc/` | Main path | agent IPC subsystem (chat handler, session/lifecycle services, Codex controller); runtime documented in [agent/](../../agent/README.md) |

## Good entry points

If you want to read the code after this doc set, start here:

1. `src/main/core/main-services.js` (service construction and IPC composition)
2. `src/main/ipc/register-data-ipc.js`
3. `src/main/helpers/main/data/data-helpers.js`
4. `src/main/helpers/main/storage-bundle/index.js`

Then move to `src/renderer/modules/sequence-viewer/main-process/sequence-library/` only if you need the biology-specific library behavior.
