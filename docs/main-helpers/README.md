# Main Helper Walkthrough

This doc set covers `src/main/helpers/main`, the main-process helper surface. `main.js` is now a thin entry that defers to `src/main/core/main-services.js`, and IPC registrars have moved to `src/main/ipc/` (covered here because they are the boot boundary into these helpers).

If `docs/agent/` explains the agent subsystem, this folder explains the rest of the main-process helper surface:

- data save/load and snapshot helpers (`data/`)
- storage bundle sidecars and SQLite indexing (`storage-bundle/`)
- app-wide storage integration for the Sequence Viewer library (`storage-bundle/`); feature-owned persistence lives in `src/renderer/modules/sequence-viewer/main-process/`
- LLM provider runtime and chat-log transform (`llm/`)
- provider-neutral agent implementations (`src/main/helpers/agent/`); composition lives in `src/main/core/services/create-agent-services.js`
- MCP/Codex service implementation and initialization (`src/main/core/services/`)
- PDF→Markdown, paper import, HTML→PDF, and chemical-import parsing
- IPC registration (in `src/main/ipc/`) plus small system integrations such as Codex CLI and Telegram bot configuration

## Recommended reading order

1. [Main-process helper overview](./architecture/main-process-helpers-overview.md)
2. [IPC registrars](./ipc/ipc-registrars.md)
3. [Storage and bundles](./data/storage-and-bundles.md)
4. [Sequence library](./sequences/sequence-library.md)
5. [Module map](./reference/module-map.md)

## What this folder owns

`src/main/helpers/main` is not a grab bag of tiny utilities. Its core boundaries are:

1. It persists and hydrates the app's data model across JSON, sidecar JSON, and SQLite (`data/`, `storage-bundle/`).
2. It provides the LLM provider runtime and the agent service bundle the renderer talks to.
3. It handles PDF/paper/chemical import and HTML→PDF rendering.

The local sequence library is no longer a generic helper. Its Node implementation lives inside the existing feature at `src/renderer/modules/sequence-viewer/main-process/sequence-library/`; only app-wide bundle and storage-root integration remains here.

The IPC registrars that expose these helpers to the renderer now live in `src/main/ipc/`.

## Where it sits in boot

`src/main/main.js` is a 5-line entry. `src/main/core/main-services.js` constructs every main-process service in dependency order and registers all IPC. It:

- creates the data helpers (`createMainDataHelpers(...)`) and app paths (`createMainAppPaths(...)`)
- imports the storage-bundle API and the feature-owned Sequence Viewer library API
- builds the provider-neutral agent foundation (`src/main/core/services/create-agent-services.js`)
- creates MCP and Codex as separate services
- registers `registerDataIpc`, `registerAgentIpc`, and `registerSystemIpc` from dependency-specific IPC adapter services

So this folder is the main-process “persistence, runtime, and import” layer, and `src/main/ipc/` is the wiring layer on top of it.

## Important note about `register-agent-ipc/`

`src/main/ipc/register-agent-ipc/` is an IPC registrar folder, but the runtime it exposes is the agent subsystem documented separately in [agent/README.md](../agent/README.md).

This walkthrough covers its role as a registrar and boot boundary. For the parser/runtime/tool flow inside that registrar, use the agent doc set.
