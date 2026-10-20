# Main Helper Walkthrough

This doc set covers the `src/main/` platform layer (`storage/`, `data/`, `lib/`) and the feature-owned main-process services beside it (`project-memory/`, `scheduled-tasks/`, `genome/`, `bioinformatics/`, `updater/`, `windows/`, `preload/`). `main.js` is a thin entry that defers to `app/start-main-app.js`, which builds `core/main-services.js`. IPC registrars live in `src/main/ipc/` (covered here because they are the boot boundary into these helpers).

If `docs/agent/` explains the agent subsystem, this folder explains the rest of the main-process helper surface:

- data save/load and snapshot helpers (`data/`)
- the storage-root layout: module-owned record folders, the chemicals SQLite index, hydration, and import (`storage/`)
- project `MEMORY.md` generation for the agent (`project-memory/`)
- scheduled Codex tasks and the paper finder (`scheduled-tasks/`, `papers/finding/`)
- reference genomes, BLAST/UniProt clients, and the npm update check (`genome/`, `bioinformatics/`, `updater/`)
- app-wide storage integration for the Sequence Viewer library (`storage/`); feature-owned persistence lives in `src/renderer/modules/sequence-viewer/main-process/`
- Codex CLI support and chat-log transform (`lib/codex-cli-provider/`, `lib/llm/`)
- provider-neutral agent implementations (`src/main/agent/`); composition lives in `src/main/core/services/create-agent-services.js`
- MCP/Codex service implementation and initialization (`src/main/core/services/`)
- PDF→Markdown, paper import, and chemical-import parsing
- IPC registration (in `src/main/ipc/`), the preload bridge (`preload/`), plus small system integrations such as Codex CLI configuration and error reporting

Folder READMEs with more detail: [`papers/`](../../src/main/papers/README.md), [`project-memory/`](../../src/main/project-memory/README.md), [`scheduled-tasks/`](../../src/main/scheduled-tasks/README.md), [`updater/`](../../src/main/updater/README.md), [`preload/`](../../src/main/preload/README.md), [`storage/`](../../src/main/storage/README.md), and [`core/`](../../src/main/core/Readme.md).

## Recommended reading order

1. [Main-process helper overview](./architecture/main-process-helpers-overview.md)
2. [IPC registrars](./ipc/ipc-registrars.md)
3. [Storage and bundles](./data/storage-and-bundles.md)
4. [Sequence library](./sequences/sequence-library.md)
5. [Module map](./reference/module-map.md)

## What this folder owns

The `src/main/` platform layer (`storage/`, `data/`, `lib/`) is not a grab bag of tiny utilities. Its core boundaries are:

1. It persists and hydrates the app's data model across the compact snapshot, per-record JSON folders, and the chemicals SQLite index (`data/`, `storage/`).
2. It provides the Codex CLI integration and the agent service bundle the renderer talks to.
3. It handles PDF/paper and chemical import.

The local sequence library is no longer a generic helper. Its Node implementation lives inside the existing feature at `src/renderer/modules/sequence-viewer/main-process/sequence-library/`; only app-wide bundle and storage-root integration remains here.

The IPC registrars that expose these helpers to the renderer now live in `src/main/ipc/`.

## Where it sits in boot

`src/main/core/main-services.js` constructs every main-process service in dependency order and registers all IPC. It:

- creates the data helpers (`createMainDataHelpers(...)`) and app paths (`createMainAppPaths(...)`)
- imports the `storage/` API and the feature-owned Sequence Viewer library API
- builds the provider-neutral agent foundation (`src/main/core/services/create-agent-services.js`)
- creates MCP and Codex as separate services, then scheduled tasks, genomes, and bioinformatics
- registers all eight IPC registrars (plugin, data, agent, genome, bioinformatics, scheduled-task, python, system) with only the dependencies each one needs

So this folder is the main-process “persistence, runtime, and import” layer, and `src/main/ipc/` is the wiring layer on top of it.

## Important note about `register-agent-ipc/`

`src/main/ipc/register-agent-ipc/` is an IPC registrar folder, but the runtime it exposes is the agent subsystem documented separately in [agent/README.md](../agent/README.md).

This walkthrough covers its role as a registrar and boot boundary. For the Codex runtime, MCP, and tool flow behind that registrar, use the agent doc set.
