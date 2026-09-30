# Main-Process Helper Overview

The `src/main/` platform layer (`storage/`, `data/`, `lib/`) is the persistence, runtime, and import layer of the main process. The IPC registrars that expose it to the renderer live one level up in `src/main/ipc/`.

## Assembly pattern

`main.js` is a short entry with one branch: launched with `--hikari-mcp-stdio`, it runs the Hikari MCP stdio server inside Electron (`agent/mcp-contract/electron-stdio-entry.js`) — this is how Codex reaches Hikari's tools from a packaged app. Otherwise it calls `app/start-main-app.js`, which owns the Electron lifecycle and calls `src/main/core/main-services.js`. That constructs every service in dependency order and registers all IPC. It:

- creates paths with `createMainAppPaths(...)`, error reporting, and the data persistence facade with `createMainDataHelpers(...)`
- imports concrete storage and LLM operations plus the feature-owned Sequence Viewer library API
- builds the provider-neutral agent foundation with `src/main/core/services/create-agent-services.js`
- creates MCP and Codex as separate dependency-ordered services, then scheduled tasks, genomes, and bioinformatics
- registers the eight IPC registrars with their own dependency sets

Service construction is synchronous. IPC registration happens before Electron readiness, async service startup happens after the window is created, and shutdown runs in reverse dependency order.

That gives the folder a consistent shape:

| Concern | Location |
| --- | --- |
| persistence facade | `data/data-helpers.js` |
| compact snapshot serialization | `data/data-snapshot-utils.js` |
| record folders, chemicals SQLite, hydration, storage import | `storage/` (folder) |
| project `MEMORY.md` for the agent | `project-memory/` |
| scheduled Codex tasks | `scheduled-tasks/` |
| reference genomes | `genome/` |
| NCBI BLAST, UniProt | `bioinformatics/` |
| npm update check | `updater/` |
| main window | `windows/create-main-window.js` |
| preload bridge (`window.hikariApi`) | `preload.js` → `preload/create-preload-api.js` + `preload/api/*` |
| sequence storage, search, annotation | `src/renderer/modules/sequence-viewer/main-process/sequence-library/` |
| sequence inference and parsing | `src/renderer/modules/sequence-viewer/` |
| Codex CLI support + chat-log transform | `lib/codex-cli-provider/` and `lib/llm/` |
| provider-neutral agent wiring | `src/main/core/services/create-agent-services.js` |
| MCP and Codex integration | `src/main/core/services/` |
| PDF and paper import | `src/main/papers/parse/` |
| chemical import | `lib/chemical-import-parser.js` |
| plugin folder validation, serving, file access | `lib/inspect-plugin-folder.js`, `lib/plugin-server.js`, `lib/plugin-files.js` |
| renderer-facing IPC | `src/main/ipc/` (eight registrars) |

## Registrars

The renderer-facing surface is split across eight registrars under `src/main/ipc/`. The three largest are:

| Registrar | Primary audience | What it exposes |
| --- | --- | --- |
| `register-data-ipc.js` + `register-data-ipc/` | renderer data and storage flows | save/load, storage-root helpers, grouped sequence endpoints, import parsers |
| `register-agent-ipc/` | renderer chat/assistant flows | `agent:chat`, chat-log session helpers, log replay |
| `register-system-ipc.js` | renderer settings/system panels | Codex CLI + direct LLM, Codex Desktop MCP prompt, error reporting, OS integrations |

The rest are small and single-purpose: `register-plugin-ipc.js`, `register-genome-ipc.js`, `register-bioinformatics-ipc.js`, `register-scheduled-task-ipc.js`, and `register-python-ipc.js`.

Channel names are centralized in `src/shared/ipc/channels.js`. See [ipc-registrars.md](../ipc/ipc-registrars.md).

## Persistence model

The persistence path is layered:

1. `data/data-snapshot-utils.js` builds a compact JSON snapshot (`buildCompactIndexedSnapshot`).
2. `data/data-helpers.js` provides high-level save/load (`saveSelectedDataFile`, `autoSaveDataFile`, `loadSelectedDataFile`, `autoLoadDataFile`).
3. `storage/` writes/reads the module-owned record folders and the chemicals SQLite index.

The primary JSON file is intentionally not the whole truth: it is the small top-level snapshot, while protocols, notebook pages, samples, assays, gels, workflows, and paper records live in one JSON file per record, and chemicals live in SQLite. See [storage-and-bundles.md](../data/storage-and-bundles.md).

## Sequence-library model

The sequence feature set is its own subdomain under the storage root, not mixed into the general snapshot:

- `src/renderer/modules/sequence-viewer/main-process/sequence-library/` manages a dedicated SQLite database (`DNA/sequence-library.sqlite`) plus per-entry files
- `src/renderer/modules/sequence-viewer/main-process/sequence-library/backbone-service.js` runs the process-neutral recognition algorithm from its sibling `algorithms/` folder against the stored library
- `register-data-ipc/register-sequence-library-ipc.js` exposes both through `sequence-library:*` endpoints

See [sequence-library.md](../sequences/sequence-library.md).

## How to navigate the code

Shortest reading path:

1. `src/main/core/main-services.js` — service construction and IPC composition
2. `src/main/ipc/register-data-ipc.js` and its `register-data-ipc/` endpoint groups — the external API surface
3. `data/data-helpers.js` and `storage/index.js` — save/load semantics
4. `src/renderer/modules/sequence-viewer/main-process/sequence-library/index.js` — only after that; it is effectively its own storage subsystem
