# IPC Registrars

The main purpose of `src/main/helpers/main` is to keep IPC registration out of `main.js`.

## `register-data-ipc.js`

This file exposes the non-agent application data API.

The endpoints fall into four groups.

## Data file endpoints

These are the top-level app snapshot operations:

- `ena:save`
- `ena:load`
- `data:auto-save`
- `data:auto-load`

All four delegate into `mainDataHelpers`, which means they share the same compact-snapshot plus sidecar-sync behavior.

## Storage helper endpoints

These endpoints operate on arbitrary storage paths:

- `storage:pick-directory`
- `storage:ensure-directory`
- `storage:store-imported-file`
- `storage:open-file`
- `storage:read-file-base64`
- `storage:import-root`

The interesting one is `storage:import-root`, which calls `importStorageRoot(...)` from `storage-bundle.js` and produces a merged summary plus a manifest file for an existing storage directory.

## Sequence library endpoints

These are the `SequenceViewer`-specific APIs:

- `sequence-library:list`
- `sequence-library:get`
- `sequence-library:upsert`
- `sequence-library:promote`
- `sequence-library:delete`
- `sequence-library:search-features`
- `sequence-library:recognize-backbone`

This is a clean example of the registrar pattern: the IPC file itself mostly validates payloads, while the real domain logic lives in `sequence-library.js` and `sequence-backbone-recognition.js`.

## Plannotate endpoints

The registrar also exposes a small Plannotate bridge:

- `plannotate:check-env`
- `plannotate:annotate`
- `plannotate:install-all`
- `plannotate:generate-gbk`

That makes `register-data-ipc.js` the general “data tools” boundary, not just snapshot save/load.

## `register-system-ipc.js`

This file is much smaller and is split between two concerns.

## Codex CLI endpoints

- `llm:codex-status`
- `llm:codex-set-model`
- `llm:codex-generate`

These endpoints are thin wrappers around the Codex CLI provider helpers from `main.js`.

## Telegram endpoints

- `telegram:get-config`
- `telegram:set-token`
- `telegram:clear-token`

These are configuration/state endpoints. They do not implement the Telegram bot directly; they coordinate saved token state plus `restartTelegramBot()`.

## `register-agent-ipc.js`

This file also lives in `src/main/helpers/main` because it is an IPC registrar, but its internal logic belongs to the agent subsystem.

Use the dedicated walkthrough at [doc/agent/architecture/request-lifecycle.md](../agent/architecture/request-lifecycle.md) for the detailed request flow.

From the perspective of this folder, the important point is architectural:

- `register-agent-ipc.js` is the third registrar alongside the data and system registrars
- it is where `main.js` hands off the fully assembled agent runtimes
- it keeps the agent controller out of `main.js`, just like the other two registrars keep their own endpoint families out of `main.js`

## Practical takeaway

When adding a new renderer-facing capability in this area of the app, the first question is usually not “which helper file should I edit?” It is “which registrar owns this capability family?”

That usually narrows the search quickly:

- data/storage/sequence/plannotate -> `register-data-ipc.js`
- chat/assistant/log replay -> `register-agent-ipc.js`
- Codex CLI or Telegram settings -> `register-system-ipc.js`
