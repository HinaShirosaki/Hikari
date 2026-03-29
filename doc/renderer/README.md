# Renderer Walkthrough

This doc set explains how `src/renderer` is assembled, how the browser-side app shell boots, and where the major feature modules live once you leave `renderer.js`.

If `doc/main-helpers/` explains the main-process bridge, this folder explains the renderer-side half of the app.

## Recommended reading order

1. [Boot and shell](./architecture/boot-and-shell.md)
2. [State, services, and search](./architecture/state-services-and-search.md)
3. [Module families](./features/module-families.md)
4. [Heavyweight subsystems](./features/heavyweight-subsystems.md)
5. [Module map](./reference/module-map.md)

## What `src/renderer` owns

`src/renderer` is not just a pile of view scripts. It owns the full renderer runtime:

- app-shell boot in `renderer.js`
- renderer-local state load, normalization, persistence, and appearance
- dock navigation, topbar search, startup-view resolution, and Telegram command routing
- feature controllers for inventory, notebooks, protocols, workflows, papers, assays, gels, agent chat, sequence viewing, and bench tools
- a small registry/service layer used to fan state changes across feature modules
- pure helper wrappers that expose algorithm-heavy code to tests or other renderer modules

## High-level mental model

1. `renderer.js` loads state from `modules/shared.js`.
2. It creates a module registry plus a small set of cross-feature services.
3. It initializes every feature module with the same mutable `state`, a shared `persist()` callback, and targeted change hooks.
4. During `initApp()`, it optionally hydrates from an `.ena` file and an external storage root through `window.enanaApi`.
5. It renders everything once, then activates the configured startup view.
6. After boot, most user actions stay inside a feature module, but navigation, persistence, search routing, and cross-module refreshes still flow back through `renderer.js`, the registry, and the service layer.

## Directory guide

| Folder | Purpose |
| --- | --- |
| `architecture/` | boot flow, renderer state, registry/services, navigation, search |
| `features/` | how feature controllers are grouped and where the large subsystems live |
| `reference/` | quick lookup map for files and folders in `src/renderer` |

## Important boundaries

- `window.enanaApi` is the renderer-to-main bridge. For the main-process side of those calls, use [doc/main-helpers/README.md](../main-helpers/README.md).
- The renderer-side Agent UI lives in `src/renderer/modules/agent-chat*`, but the actual agent backend is documented separately in [doc/agent/README.md](../agent/README.md).
- `src/renderer/modules/app-registry.generated.js` is generated from `ui/config/app-registry.json`, so dock layout, labels, aliases, and search-scope wiring start from config, not handwritten renderer code.
