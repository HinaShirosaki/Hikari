# Hikari Internal Docs

These are the internal architecture docs for Hikari, the local-first Electron lab-work app. For a product overview, see the top-level [Readme.md](../Readme.md); for the full feature, setup, and development reference, see the [Hikari Guide](guide/README.md).

## The big picture

Hikari is an Electron app with two processes plus an agent backend:

- **Renderer** (`src/renderer/`) — the browser-side single-page app. Feature workspaces are **folder modules** (`modules/<feature>/index.js`) registered through `module-manifests/`, glued together by a generated app registry, the renderer core, and a thin module runtime. Renderer state lives in `localStorage`; saves and storage-root hydration go through the `window.hikariApi` bridge.
- **Main process** (`src/main/`) — `main.js` is a thin entry that defers to `app/start-main-app.js`, which builds `core/main-services.js`; that constructs services in dependency order and registers all IPC. Feature-owned Node services have their own folders: `papers/`, `project-memory/`, `scheduled-tasks/`, `genome/`, `bioinformatics/`, and `updater/`. The Sequence Viewer keeps its Node-only storage half inside its module at `src/renderer/modules/sequence-viewer/main-process/`. Generic persistence lives under `src/main/storage/` and `src/main/data/`, with shared runtime utilities under `src/main/lib/`. IPC registrars live in `src/main/ipc/` and are invoked from `core/main-services.js`. Channel names are centralized in `src/shared/ipc/channels.js`.
- **Agent backend** (`src/main/agent/`) — the Codex-owned main-process assistant. It is assembled by `createMainAgentServices(...)`, exposed through `src/main/ipc/register-agent-ipc/`, and backed by MCP contracts plus a shared tool executor. Domain implementations such as paper services remain under their owning `src/main/<domain>/` folders.

## Doc sets

| Doc set | What it covers |
| --- | --- |
| [guide/](guide/README.md) | The user-facing feature, setup, storage, and development reference |
| [getting-started/](getting-started/first-experiment.md) | The 15-minute first-experiment tutorial |
| [renderer/](renderer/README.md) | Browser-side boot and shell, renderer state/services/search, module families, the heavyweight subsystems, and a file map |
| [main-platform/](main-platform/README.md) | Main-process persistence, storage bundles, LLM runtime, IPC registrars, and links to feature-owned Node services |
| [agent/](agent/README.md) | The Codex agent backend: request lifecycle, runtime support, tools, context/observability, and the MCP contract |
| [module-development/](module-development/README.md) | How to add a new renderer feature module from scratch (the build pipeline, the `init*()` contract, and the wiring checklist) |
| [plugins/](plugins/README.md) | The user plugin system: plugin folder format, Settings-based install flow, the bridge API, service plugins, sandboxing, and limitations |
| [reviews/](reviews/) | Dated code reviews (cloning assembly, test suite). Snapshots of the code at the time; file names in them may have moved since |
| [screenshots/](screenshots/README.md) | README and guide screenshots, and how they were captured |

## Where to start

- **Adding a feature?** → [module-development/](module-development/README.md)
- **Understanding the renderer?** → [renderer/architecture/boot-and-shell.md](renderer/architecture/boot-and-shell.md), then [renderer/reference/module-map.md](renderer/reference/module-map.md)
- **Understanding persistence/IPC?** → [main-platform/README.md](main-platform/README.md), then [main-platform/ipc/ipc-registrars.md](main-platform/ipc/ipc-registrars.md)
- **Understanding the assistant?** → [agent/architecture/request-lifecycle.md](agent/architecture/request-lifecycle.md), then [agent/reference/module-map.md](agent/reference/module-map.md)

## A note on generated files

`agent/reference/json-schemas.md` is a hand-maintained map to the live schema sources. `index.html`, `styles.css`, `src/renderer/modules/views.js`, and the `*.generated.js` modules come from `npm run build:ui` and are not committed; edit their sources under `ui/` (and `scripts/build-ui/llm-catalog.mjs` for the Codex provider modules) instead.
