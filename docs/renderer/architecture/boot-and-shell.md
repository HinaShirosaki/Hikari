# Boot And Shell

This walkthrough follows the browser-side boot path from `src/renderer/renderer.js` into the renderer core.

## Why The Core Matters

Most feature code lives under `src/renderer/modules/`, while `src/renderer/core/start-hikari-core.js` is the file that turns those isolated controllers into one application. It owns:

- initial state load
- appearance setup
- module/service registry creation
- feature-module initialization
- storage hydration
- dock and overflow navigation
- topbar search wiring
- startup-view selection
- a few renderer-global debug and integration hooks

## Boot sequence

The boot path is straightforward once you read it as a pipeline instead of a monolith:

1. `loadState()` from `modules/app-state.js` creates the mutable renderer `state`.
2. `applyAppearanceSnapshot(...)` applies the saved font size and day/night mode before the UI starts rendering.
3. `APP_REGISTRY` and `APP_DOCK_ORDER` from `modules/app-registry.generated.js` are turned into lookup maps for:
   - app id to app metadata
   - view id to app metadata
   - global view aliases
   - search scopes
4. `createModuleRegistry(...)` is seeded with generic UI bridge functions such as `showView`, `setSearchInputValue`, and `VIEWS`.
5. `createRendererServices(...)` builds the thin cross-feature service layer.
6. Feature modules are initialized through `module-manifests/`, then registered into the module registry by `module-runtime.js`.
7. `initApp()` runs asynchronous storage-root hydration through `hydrateStateFromStorageRoot()`.
8. The shell renders navigation, binds listeners, calls `renderAll()`, then opens `resolveStartupViewId()`.

The important pattern is that feature modules are created before async hydration finishes, but most visible UI does not matter until `renderAll()` runs after hydration.

## App registry and dock behavior

`modules/app-registry.generated.js` gives the renderer a config-driven shell:

- labels and icons
- canonical `viewId`
- dock-vs-overflow placement
- aliases for topbar search and command routing
- optional search input ids for scoped searches

The renderer core then computes:

- `DOCK_APPS`: the preferred visible apps
- `MORE_APPS`: overflow candidates
- responsive dock capacity based on viewport width
- alias maps for commands like `assay`, `gels`, `papers`, or `dna`

One subtle detail is that the dock tries to keep the active app visible even when the viewport is too narrow to show the full preferred dock order.

## View activation model

`showView(viewId)` is the runtime switchboard for the shell.

It does more than toggle classes:

- normalizes aliased views
- remembers the last active view when startup settings allow it
- updates body classes for agent/sequence-viewer scrolling behavior
- keeps the dock and overflow state in sync
- updates the page title and subtitle
- closes the overflow menu
- triggers view-specific re-renders only for the newly active module

Examples:

- opening `sample-registry-view` renders both the personal-inventory container workspace and the sample registry list, because those two modules share one workspace
- opening the special sequence-detail pseudo-view still highlights the `Sequence Viewer` app in navigation
- opening `agent-view` rerenders only the agent UI instead of rerendering the whole app

`renderAll()` is the heavier path used after hydration or major state replacement. `showView()` is the lighter steady-state path.

## State replacement and persistence

The renderer core owns two important shell-level helpers:

- `persist()`: records an undo checkpoint, normalizes storage paths, writes local storage, and optionally auto-saves the `.ena` file through `window.hikariApi.autoSaveDataFile(...)`

That means feature modules usually mutate shared state directly and then call the shared `persist()` callback instead of owning their own storage layer.

## Main-process integration points

The renderer shell talks to the main process through `window.hikariApi`.

Key boot-time or shell-level calls include:

- `autoSaveDataFile(data, filePath)` — writes the compact snapshot and syncs the storage bundle
- `importStorageRoot(storagePath)` — hydrates from an external storage directory
- `ensureStorageDirectory(path)` / `pickStorageDirectory(currentPath)` — storage path setup
- `onProtocolRecordSaved(handler)` — subscribes to externally saved protocols (delegated to the protocol service)
- `onTelegramCommand(handler)` — subscribes to Telegram command events

Renderer state itself is loaded from `localStorage` (`loadState()` in `modules/app-state.js`), not from a bridge call — there is no `loadEnaFile`/`autoLoadDataFile` on `window.hikariApi`. The full bridge surface is assembled in `src/main/preload/create-preload-api.js` from the per-domain `api/*.js` modules. For the main-process side of those calls, use [doc/main-platform/README.md](../../main-platform/README.md).

## External command hook

During initialization, the topbar search controller's `initTelegramCommandBridge()` subscribes to `window.hikariApi.onTelegramCommand(...)` and routes open-view or search commands back through the normal navigation/search pipeline. The renderer core owns that bridge so external commands reuse the same aliases and target handlers as local search.
