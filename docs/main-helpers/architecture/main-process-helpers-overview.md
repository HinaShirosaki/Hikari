# Main-Process Helper Overview

`src/main/helpers/main` is the persistence, runtime, and import layer of the main process. The IPC registrars that expose it to the renderer live one level up in `src/main/ipc/`.

## Assembly pattern

`main.js` is a 5-line entry. The real boot lives in `src/main/core/start-hikari-main-core.js`, which:

- creates the data persistence facade with `createMainDataHelpers(...)` and paths with `createMainAppPaths(...)`
- imports concrete storage, sequence-library, and LLM operations
- builds the agent service bundle with `create-main-agent-services.js`
- hands those into `registerMainIpc({ data, agent, system })` from `src/main/ipc/`

That gives the folder a consistent shape:

| Concern | Location |
| --- | --- |
| persistence facade | `data/data-helpers.js` |
| compact snapshot serialization | `data/data-snapshot-utils.js` |
| bundle sidecars, SQLite, storage import | `storage-bundle/` (folder) |
| sequence storage, search, annotation | `sequence-library/` (folder) |
| sequence inference (shared algorithm) | `sequence/` (folder) |
| LLM provider runtime + chat-log transform | `llm/` (folder) |
| agent service wiring | `create-main-agent-services.js`, `agent-mcp-initializer.js` |
| PDF/paper/chemical import | `pdf-to-md.js`, `paper-markdown-import.js`, `chemical-import-parser.js`, ... |
| renderer-facing IPC | `src/main/ipc/` (data / system / agent registrars) |

## Three-registrar model

The renderer-facing surface is still dominated by three registrars, now under `src/main/ipc/` and aggregated by `registerMainIpc(...)`:

| Registrar | Primary audience | What it exposes |
| --- | --- | --- |
| `register-data-ipc.js` | renderer data and storage flows | save/load, storage-root helpers, sequence library, import parsers |
| `register-agent-ipc/` | renderer chat/assistant flows | `agent:chat`, chat-log session helpers, developer tool tests, log replay |
| `register-system-ipc.js` | renderer settings/system panels | Codex CLI + direct LLM, Telegram config, open-external-url |

Channel names are centralized in `src/shared/ipc/channels.js`. See [ipc-registrars.md](../ipc/ipc-registrars.md).

## Persistence model

The persistence path is layered:

1. `data/data-snapshot-utils.js` builds a compact JSON snapshot (`buildCompactIndexedSnapshot`).
2. `data/data-helpers.js` provides high-level save/load (`saveSelectedDataFile`, `autoSaveDataFile`, `loadSelectedDataFile`, `autoLoadDataFile`).
3. `storage-bundle/` writes/reads the heavier sidecars and the SQLite index.

The primary JSON file is intentionally not the whole truth: it is the small top-level snapshot, while protocols, notebook pages, and searchable inventory/record indexes live in companion files. See [storage-and-bundles.md](../data/storage-and-bundles.md).

## Sequence-library model

The sequence feature set is its own subdomain under the storage root, not mixed into the general snapshot:

- `sequence-library/` manages a dedicated SQLite database (`SequenceViewer/sequence-library.sqlite`) plus per-entry files
- `sequence/sequence-backbone-recognition.js` re-exports the recognition algorithm shared with the renderer (`renderer/modules/sequence-viewer/algorithms/`), and `sequence-library/backbone-service.js` runs it against the library
- `register-data-ipc.js` exposes both through `sequence-library:*` endpoints

See [sequence-library.md](../sequences/sequence-library.md).

## How to navigate the code

Shortest reading path:

1. `src/main/core/start-hikari-main-core.js` — boot and IPC wiring
2. `src/main/ipc/register-data-ipc.js` — the external API surface
3. `data/data-helpers.js` and `storage-bundle/index.js` — save/load semantics
4. `sequence-library/index.js` — only after that; it is effectively its own storage subsystem
