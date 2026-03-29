# Module Map

This is a quick lookup map for `src/main/helpers/main`.

## Legend

- `Main path`: directly involved in app boot or renderer IPC handling
- `Support`: helper used by a main-path file
- `Specialized`: domain-specific subsystem with its own internal workflow

## Files

| File | Status | Notes |
| --- | --- | --- |
| `data-helpers.js` | Main path | compact facade for selected/auto save and load |
| `data-snapshot-utils.js` | Support | creates the compact snapshot written to disk |
| `storage-bundle.js` | Main path | sidecar path derivation, bundle sync, hydration, storage-root import, manifest generation |
| `register-data-ipc.js` | Main path | renderer data/storage/sequence/plannotate endpoints |
| `register-system-ipc.js` | Main path | renderer Codex CLI and Telegram configuration endpoints |
| `register-agent-ipc.js` | Main path | renderer agent endpoints; detailed flow is documented in `doc/agent/` |
| `sequence-library.js` | Specialized | `SequenceViewer` SQLite/file storage plus entry CRUD and feature search |
| `sequence-backbone-recognition.js` | Specialized | heuristic backbone/insertion recognition against the sequence library |

## Good entry points

If you want to read the code after this doc set, start here:

1. `src/main/helpers/main/register-data-ipc.js`
2. `src/main/helpers/main/data-helpers.js`
3. `src/main/helpers/main/storage-bundle.js`

Then move to the sequence files only if you need the biology-specific library behavior.
