# Main-Process Helper Overview

The easiest way to understand `src/main/helpers/main` is to read it as the “supporting infrastructure” side of `src/main/main.js`.

## Assembly pattern in `main.js`

`main.js` does three things with this folder:

- it creates a small data persistence facade with `createMainDataHelpers(...)`
- it imports concrete storage and sequence operations
- it hands those operations into IPC registrar functions

That gives the folder a very consistent shape:

| Concern | Main file |
| --- | --- |
| persistence facade | `data-helpers.js` |
| compact snapshot serialization | `data-snapshot-utils.js` |
| bundle sidecars and storage import | `storage-bundle.js` |
| sequence storage and search | `sequence-library.js` |
| sequence inference | `sequence-backbone-recognition.js` |
| renderer-facing data IPC | `register-data-ipc.js` |
| renderer-facing system IPC | `register-system-ipc.js` |
| renderer-facing agent IPC | `register-agent-ipc.js` |

## Three registrar model

The folder's public shape is dominated by three registrar files:

| Registrar | Primary audience | What it exposes |
| --- | --- | --- |
| `register-data-ipc.js` | renderer data and storage flows | save/load, storage root helpers, sequence library, Plannotate |
| `register-agent-ipc.js` | renderer chat/assistant flows | `agent:chat`, chat-log helpers, tool smoke tests, lifecycle replay |
| `register-system-ipc.js` | renderer settings/system panels | Codex CLI status/generation, Telegram bot config |

This split is useful because it keeps `main.js` from turning into a long sequence of `ipcMain.handle(...)` calls.

## Persistence model

The persistence path in this folder is layered:

1. `data-snapshot-utils.js` creates a compact JSON snapshot.
2. `data-helpers.js` provides high-level save/load operations.
3. `storage-bundle.js` writes or reads the heavier sidecars and SQLite index.

That means the primary JSON file is intentionally not the whole truth anymore. It is the small top-level snapshot, while protocols, notebook pages, and searchable inventory/record indexes live in companion files.

## Sequence-library model

The sequence feature set is its own subdomain. It is not mixed into the general snapshot helpers.

Instead:

- `sequence-library.js` manages a dedicated SQLite database plus per-entry files
- `sequence-backbone-recognition.js` runs a separate heuristic matching algorithm against that library
- `register-data-ipc.js` exposes both through `sequence-library:*` endpoints

This separation is a good clue that sequence data is operationally different from the rest of the app's data snapshot.

## How to navigate the code

If you want the shortest reading path:

1. read `register-data-ipc.js` to see the external API surface
2. read `data-helpers.js` and `storage-bundle.js` to understand save/load semantics
3. read `sequence-library.js` only after that, because it is effectively its own storage subsystem

That sequence matches how a renderer request moves through the folder.
