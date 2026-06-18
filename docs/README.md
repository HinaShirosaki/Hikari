# Hikari Internal Docs

These are the internal architecture docs for Hikari, the local-first Electron lab-work app. For a product/feature overview and setup, see the top-level [Readme.md](../Readme.md).

## The big picture

Hikari is an Electron app with two processes plus an agent backend:

- **Renderer** (`src/renderer/`) — the browser-side single-page app. Feature workspaces are **folder modules** (`modules/<feature>/index.js`) registered through `module-manifests/`, glued together by a generated app registry, the renderer core, and a thin module runtime. Renderer state lives in `localStorage`; saves and storage-root hydration go through the `window.hikariApi` bridge.
- **Main process** (`src/main/`) — `main.js` is a thin entry that defers to the generic lifecycle in `core/start-hikari-main-core.js`; dependency composition lives in `core/main-service-catalog.js`. It owns persistence (compact snapshot + storage bundle + SQLite), the sequence library, the LLM runtime, paper/PDF/chemical import, and the Telegram bot. IPC registrars live in `src/main/ipc/` and are invoked by catalog IPC-adapter services. Channel names are centralized in `src/shared/ipc/channels.js`.
- **Agent backend** (`src/main/helpers/agent/`) — the main-process assistant. Assembled by `createMainAgentServices(...)` and exposed through `src/main/ipc/register-agent-ipc/`. It is parser-first for most providers, with a dedicated Codex provider path, and a full tool suite registered on a shared executor.

## Doc sets

| Doc set | What it covers |
| --- | --- |
| [renderer/](renderer/README.md) | Browser-side boot and shell, renderer state/services/search, module families, the heavyweight subsystems, and a file map |
| [main-helpers/](main-helpers/README.md) | Main-process persistence, storage bundles, the sequence library, LLM runtime, IPC registrars, and a file map |
| [agent/](agent/README.md) | The agent backend: request lifecycle, runtimes, tools, context/observability, deep research, and the MCP contract |
| [module-development/](module-development/README.md) | How to add a new renderer feature module from scratch (the build pipeline, the `init*()` contract, and the wiring checklist) |

## Where to start

- **Adding a feature?** → [module-development/](module-development/README.md)
- **Understanding the renderer?** → [renderer/architecture/boot-and-shell.md](renderer/architecture/boot-and-shell.md), then [renderer/reference/module-map.md](renderer/reference/module-map.md)
- **Understanding persistence/IPC?** → [main-helpers/README.md](main-helpers/README.md), then [main-helpers/ipc/ipc-registrars.md](main-helpers/ipc/ipc-registrars.md)
- **Understanding the assistant?** → [agent/architecture/request-lifecycle.md](agent/architecture/request-lifecycle.md), then [agent/reference/module-map.md](agent/reference/module-map.md)

## A note on generated files

Some files under these docs are large generated exports, not hand-written — `agent/reference/agent-prompts.md` (`npm run export:agent-prompts`) and `agent/reference/agent-context-debug.md` (`npm run export:agent-context-debug`), plus the `agent/reference/json-schemas.md` schema dump. Treat them as build artifacts rather than editing by hand. Likewise, `index.html`, `styles.css`, `src/renderer/modules/views.js`, and the `*.generated.js` modules come from `npm run build:ui`; edit their sources under `ui/` and `config/` instead.
