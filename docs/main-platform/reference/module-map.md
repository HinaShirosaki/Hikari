# Module Map

This is a quick lookup map for the `src/main/` platform layer (`storage/`, `data/`, `lib/`) and the feature-owned main-process services beside it. The agent backend (`src/main/agent/`) has its own map in [agent/reference/module-map.md](../../agent/reference/module-map.md), and paper services live under `src/main/papers/`.

## Legend

- `Main path`: directly involved in app boot or persistence
- `Support`: helper used by a main-path file
- `Specialized`: domain-specific subsystem with its own internal workflow

## Boot

| File | Status | Notes |
| --- | --- | --- |
| `main.js` | Main path | entry; runs the MCP stdio server when launched with `--hikari-mcp-stdio`, otherwise starts the app |
| `app/start-main-app.js` | Main path | Electron lifecycle: Squirrel hooks, crash reporting, window creation, `start()` / `shutdown()`, the unsaved-changes close handshake |
| `core/main-services.js` | Main path | the only composition root: constructs services in dependency order and registers all IPC |
| `core/services/` | Main path | agent, MCP, Codex, Codex-workspace, agent-log, and notebook-suggestion service factories, plus the assay plot bridge |
| `windows/create-main-window.js` | Main path | the main `BrowserWindow`, preload wiring, and navigation guards |
| `preload.js` → `preload/create-preload-api.js` | Main path | builds `window.hikariApi` from one `preload/api/*-api.js` file per domain |

## Data persistence — `data/`

| File | Status | Notes |
| --- | --- | --- |
| `data/data-helpers.js` | Main path | `createMainDataHelpers(...)` — facade for selected/auto save and load |
| `data/data-snapshot-utils.js` | Support | builds the compact snapshot written to disk |

## Storage root — `storage/`

Root-folder layout, per-record folders, hydration, storage-root import, and the chemicals SQLite index. See [storage-and-bundles.md](../data/storage-and-bundles.md).

| File | Status | Notes |
| --- | --- | --- |
| `storage/index.js` | Main path | re-export surface: `getBundlePaths`, `syncBundleFromSnapshot`, `syncSqliteBundleFromSnapshot`, `hydrateSnapshotFromBundle`, `importStorageRoot`, `discoverPapersFromStorageRoot`, workflow-root sync/hydrate/import |
| `storage/storage-paths.js` | Support | root-folder names, `RECORD_FOLDERS` (assays, gels), and `getBundlePaths` |
| `storage/storage-sidecars.js` | Main path | `syncBundleFromSnapshot`: writes every record folder in one save; agent-owned skill release is injected by `main-services.js` |
| `storage/storage-hydration.js` + `storage/hydration/` | Main path | snapshot hydration from protocol, project, sample, workflow, paper, assay, and gel folders |
| `storage/storage-import.js` | Main path | storage-root import (serialised) and folder recognition |
| `storage/storage-discovery.js` | Support | snapshot candidate detection and per-snapshot summaries |
| `storage/sample-containers.js` | Support | `Samples/<zone>/<container>__<id>.json` read/write |
| `storage/experiment-log-storage.js` | Support | `Dashboard/experiment-log.json` read/write |
| `storage/workflow-storage.js` + `storage/workflow/` | Support | `Workflow/` template and run folders |
| `storage/paper-discovery.js` | Support | finds PDFs under the storage root and reads the `<file>.pdf.json` records beside them |
| `storage/storage-sql-read.js` / `storage-sql-write.js` / `storage-sql-schema.js` | Support | chemicals SQLite index |
| `storage/chemical-index-guard.js` | Support | moves an unreadable chemicals index aside instead of overwriting it |
| `storage/sequence-library-summary.js` | Support | summarizes the Sequence Viewer library during import |
| `storage/storage-utils.js` | Support | shared helpers (`cleanText`, `sanitizeFolderName`, JSON reads, `keepLatestById`) |

## Feature-owned services

| Folder | Status | Notes |
| --- | --- | --- |
| `project-memory/` | Specialized | collects project records and writes the agent-facing `Project/<project>/MEMORY.md`, with cached LLM notebook conclusions and per-project write queues |
| `scheduled-tasks/` | Specialized | scheduled Codex tasks: normalization, calendar recurrence, the Codex task runner, persistence to `Config/scheduled-tasks.json` |
| `genome/` | Specialized | reference-genome registry (`Config/genome-library.json`) and a streaming FASTA indexer for region reads |
| `bioinformatics/` | Specialized | NCBI BLAST submit/poll/results and UniProt search/lookup over a shared request client |
| `updater/` | Specialized | npm registry release metadata, version comparison, installer lookup, and the update dialog |
| `papers/` | Specialized | search, retrieve, download, parse, identity, analysis, knowledge store, paper-finding, and literature workflow services (used by Papers and the agent) |

## Sequence Viewer library — feature-owned

The biology-specific local library is owned by `src/renderer/modules/sequence-viewer/main-process/sequence-library/`, inside the existing Sequence Viewer feature. Its `index.js` is the only public Node entrypoint; the agent's sequence tools live beside it in `main-process/mcp/`.

See [Sequence library](../sequences/sequence-library.md) and `src/renderer/modules/sequence-viewer/main-process/README.md` for the storage, search, annotation, alignment, and backbone-recognition map.

## Shared utilities — `lib/`

| File | Status | Notes |
| --- | --- | --- |
| `lib/app-paths.js` | Main path | `createMainAppPaths(...)` — app-data, storage-root pointer, logs, sandbox, Codex home, scheduled-task and genome paths |
| `lib/codex-cli-provider.js` + `lib/codex-cli-provider/` | Main path | Codex CLI discovery, login, model catalog, runtime home, and one-shot/turn requests |
| `lib/llm/` | Support | direct (non-agent) LLM module registry, request context, runtime helpers, and the chat-log transform monitor |
| `lib/error-reporting.js` | Support | local-only crash dumps and `Logs/errors.log`; nothing is uploaded |
| `lib/inspect-plugin-folder.js` | Support | validates a plugin folder and its `plugin.json` permissions |
| `lib/plugin-server.js` | Support | serves a plugin folder on its own `http://127.0.0.1:<port>` origin |
| `lib/plugin-files.js` | Support | plugin file read/write confined to `Plugins/<plugin-id>/`, rejecting links |
| `lib/chemical-import-parser.js` + `lib/chemical-import/` | Support | parses chemical-inventory import tables (incl. gzip) |
| `lib/path-safety.js` | Support | `ensurePathWithinRoot`, `isPathInside`, and related guards |
| `lib/shared-json-file.js` | Support | serialized read-modify-write and atomic replace for shared JSON files |
| `lib/sqlite.js`, `lib/sqlite-persist.js`, `lib/sqljs-path.js` | Support | sql.js loading and queries, crash-safe database persistence, and locating the sql.js wasm across dev/packaged layouts |
| `lib/normalize.js`, `lib/value-utils.js` | Support | canonical value normalizers (`asArray`, `ensureObject`, `clamp`, …) |
| `lib/web-text.js` | Support | safe URL parsing, HTML stripping, and response-text reading for web tools |
| `lib/preferred-journals.js` | Support | normalizes the preferred-journal list from Settings |

## Agent service wiring

| File | Status | Notes |
| --- | --- | --- |
| `core/services/create-agent-services.js` | Main path | composition root for the provider-neutral agent foundation (LLM bridge, tools, controllers) |
| `core/services/create-mcp-service.js` | Main path | the loopback MCP host |
| `core/services/create-codex-service.js` | Main path | Codex runtime: workspace init, turns, sub-agents |
| `core/services/create-codex-workspace-initializer.js` | Main path | composes Codex runtime-home configuration and official skill release around the provider-neutral MCP host |

## IPC — `src/main/ipc/`

See [ipc-registrars.md](../ipc/ipc-registrars.md).

| File | Status | Notes |
| --- | --- | --- |
| `ipc/register-data-ipc.js` + `register-data-ipc/` | Main path | storage, import parsers, and the grouped sequence-library endpoints |
| `ipc/register-plugin-ipc.js` | Main path | plugin folder inspection, serving, file access, and export |
| `ipc/register-agent-ipc/` | Main path | agent IPC subsystem (chat handler, lifecycle, controller core, log handlers); runtime documented in [agent/](../../agent/README.md) |
| `ipc/register-scheduled-task-ipc.js` | Main path | scheduled tasks and paper finding |
| `ipc/register-genome-ipc.js`, `ipc/register-bioinformatics-ipc.js` | Main path | genome library and BLAST/UniProt |
| `ipc/register-python-ipc.js` | Main path | Python sandbox runs |
| `ipc/register-system-ipc.js` | Main path | Codex CLI, direct LLM, error reporting, OS integrations |

## Good entry points

If you want to read the code after this doc set, start here:

1. `src/main/core/main-services.js` (service construction and IPC composition)
2. `src/main/ipc/register-data-ipc.js`
3. `src/main/data/data-helpers.js`
4. `src/main/storage/index.js`

Then move to `src/renderer/modules/sequence-viewer/main-process/sequence-library/` only if you need the biology-specific library behavior.
