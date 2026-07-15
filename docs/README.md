# Hikari Internal Docs

These are the internal architecture docs for Hikari, the local-first Electron lab-work app. For a product/feature overview and setup, see the top-level [Readme.md](../Readme.md).

## The big picture

Hikari is an Electron app with two processes plus an agent backend:

- **Renderer** (`src/renderer/`) — the browser-side single-page app. Feature workspaces are **folder modules** (`modules/<feature>/index.js`) registered through `module-manifests/`, glued together by a generated app registry, the renderer core, and a thin module runtime. Renderer state lives in `localStorage`; saves and storage-root hydration go through the `window.hikariApi` bridge.
- **Main process** (`src/main/`) — `main.js` is a thin entry that defers to `core/main-services.js`, which constructs services in dependency order and registers all IPC. Papers owns its Node services under `src/main/papers/`; the Sequence Viewer keeps its Node-only storage half inside its existing module at `src/renderer/modules/sequence-viewer/main-process/`. Generic persistence lives under `src/main/storage/` and `src/main/data/`, with shared runtime utilities under `src/main/lib/`. IPC registrars live in `src/main/ipc/` and are invoked from `core/main-services.js`. Channel names are centralized in `src/shared/ipc/channels.js`.
- **Agent backend** (`src/main/agent/`) — the Codex-owned main-process assistant. It is assembled by `createMainAgentServices(...)`, exposed through `src/main/ipc/register-agent-ipc/`, and backed by MCP contracts plus a shared tool executor. Domain implementations such as paper services remain under their owning `src/main/<domain>/` folders.

## Doc sets

| Doc set | What it covers |
| --- | --- |
| [renderer/](renderer/README.md) | Browser-side boot and shell, renderer state/services/search, module families, the heavyweight subsystems, and a file map |
| [main-platform/](main-platform/README.md) | Main-process persistence, storage bundles, LLM runtime, IPC registrars, and links to feature-owned Node services |
| [agent/](agent/README.md) | The Codex agent backend: request lifecycle, runtime support, tools, context/observability, and the MCP contract |
| [module-development/](module-development/README.md) | How to add a new renderer feature module from scratch (the build pipeline, the `init*()` contract, and the wiring checklist) |
| [plugins/](plugins/plugin-system.md) | The user plugin system: plugin folder format, Settings-based install flow, boot internals, sandboxing, and limitations |

## Where to start

- **Adding a feature?** → [module-development/](module-development/README.md)
- **Understanding the renderer?** → [renderer/architecture/boot-and-shell.md](renderer/architecture/boot-and-shell.md), then [renderer/reference/module-map.md](renderer/reference/module-map.md)
- **Understanding persistence/IPC?** → [main-platform/README.md](main-platform/README.md), then [main-platform/ipc/ipc-registrars.md](main-platform/ipc/ipc-registrars.md)
- **Understanding the assistant?** → [agent/architecture/request-lifecycle.md](agent/architecture/request-lifecycle.md), then [agent/reference/module-map.md](agent/reference/module-map.md)

## A note on generated files

`agent/reference/json-schemas.md` is a hand-maintained map to the live schema sources. `index.html`, `styles.css`, `src/renderer/modules/views.js`, and the `*.generated.js` modules come from `npm run build:ui`; edit their sources under `ui/` and `config/` instead.
