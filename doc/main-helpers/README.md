# Main Helper Walkthrough

This doc set covers `src/main/helpers/main`, which is the main-process boundary layer sitting between `src/main/main.js` and the rest of the app.

If `doc/agent/` explains the agent subsystem, this folder explains the rest of the main-process helper surface:

- IPC registration
- data save/load and storage management
- bundle sidecars and SQLite indexing
- sequence-library persistence and backbone recognition
- small system integrations such as Codex CLI and Telegram bot configuration

## Recommended reading order

1. [Main-process helper overview](./architecture/main-process-helpers-overview.md)
2. [IPC registrars](./ipc/ipc-registrars.md)
3. [Storage and bundles](./data/storage-and-bundles.md)
4. [Sequence library](./sequences/sequence-library.md)
5. [Module map](./reference/module-map.md)

## What this folder owns

`src/main/helpers/main` is not a grab bag of tiny utilities. It owns three important boundaries:

1. It registers main-process IPC endpoints.
2. It persists and hydrates the app's data model across JSON, sidecar JSON, and SQLite.
3. It manages the local sequence library under the storage root.

## Where it sits in boot

In `src/main/main.js`, this folder is used to:

- create `mainDataHelpers`
- import the storage-bundle helpers
- import the sequence-library API
- register `registerDataIpc(...)`
- register `registerAgentIpc(...)`
- register `registerSystemIpc(...)`

So this folder is the main-process “wiring and persistence” layer.

## Important note about `register-agent-ipc.js`

`register-agent-ipc.js` lives in this folder because it is an IPC registrar, but the runtime it exposes is the agent subsystem documented separately in [doc/agent/README.md](../agent/README.md).

This walkthrough covers its role as a registrar and boot boundary. For the parser/runtime/tool flow inside that registrar, use the agent doc set.
