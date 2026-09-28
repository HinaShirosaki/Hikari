# Boot And Shell

This walkthrough follows the browser-side boot path from `src/renderer/renderer.js` into the renderer core.

## Entry

`src/renderer/renderer.js` installs four small global helpers and then boots the app:

- `installRendererErrorReporting()` (`app/error-reporting.js`) — forwards uncaught errors and rejections to main's `Logs/errors.log`
- `installIconButtonCaptions()` (`app/icon-button-captions.js`) — hover captions for icon-only buttons, taken from their `aria-label`/`title` or `data-icon-caption`
- `installSearchFieldLens()` (`lib/search-field-lens.js`) — wraps every `<input type="search">` in the shared rounded field with a magnifier button
- `startHikariCore()` (`core/start-hikari-core.js`)
- `installDialogLayout()` (`app/dialog-layout.js`) — keeps dialogs clear of the topbar (`--app-dialog-safe-top`)

Before any of that, `bootstrap/index-shell.js` (loaded by the generated `index.html`) restores the saved appearance so the first paint uses the right theme.

## Why The Core Matters

Most feature code lives under `src/renderer/modules/`, while `src/renderer/core/start-hikari-core.js` is the file that turns those isolated controllers into one application. It owns:

- initial state load
- plugin installation and the plugin bridge
- appearance setup
- module/service registry creation
- feature-module initialization (through `core/module-runtime.js` and `core/manifest-runtime.js`)
- storage hydration and the first-launch workspace page
- wiring the navigation shell and topbar search (implemented under `app/`)
- startup-view selection
- the final `hikari:app-ready` event

## Boot sequence

The boot path is straightforward once you read it as a pipeline instead of a monolith:

1. `loadState()` from `modules/app-state/index.js` creates the mutable renderer `state` from `localStorage`.
2. The plugin bridge (`app/plugin-bridge.js`) and the plugin service registry (`app/plugin-services.js`) are created, and `installPlugins(...)` (`app/plugin-loader.js`) adds each enabled plugin's view and registry entry. This happens first because the navigation shell and search maps snapshot `APP_REGISTRY` and the `.view` sections.
3. `APP_REGISTRY` and `APP_DOCK_ORDER` from `modules/app-registry.generated.js` are turned into global view aliases and search-scope maps.
4. `applyAppearanceSnapshot(...)` applies the saved font size and day/night mode, and the shared left-rail resizers are installed.
5. The undo service is created, then `createModuleRegistry(...)` is seeded with generic UI bridge functions (`showView`, `setSearchInputValue`, `VIEWS`) and `createRendererServices(...)` builds the thin cross-feature service layer.
6. `createRendererModuleRuntime(...)` initializes every feature module declared in `module-manifests/` and registers its public API in the module registry.
7. The unsaved-changes service, the navigation shell (`app/navigation-shell.js`), the topbar open-item handlers, and the topbar search controller are created and bound.
8. The storage setup controller (`app/storage-setup.js`) is prepared, and the core subscribes to `onPaperFileSaved` and `onProtocolRecordSaved`. Protocol events that arrive before hydration finishes are queued.
9. `initApp()` checks that the preload bridge exists under Electron, runs `hydrateStateFromStorageRoot()`, applies queued protocol events, resets the undo history, renders navigation, and calls `renderAll()`.
10. If no storage root is set, or loading it failed, the first-launch workspace page (**Choose Folder**) is shown. Otherwise `resolveStartupViewId()` picks the startup view and it opens.
11. `hikari:app-ready` is dispatched on `window` (with `detail.error` if boot failed).

The important pattern is that feature modules are created before async hydration finishes, but most visible UI does not matter until `renderAll()` runs after hydration.

## App registry and dock behavior

`modules/app-registry.generated.js` gives the renderer a config-driven shell:

- labels and icons
- canonical `viewId`
- dock-vs-overflow placement
- aliases for topbar search and command routing
- optional search input ids for scoped searches
- whether the view gets the agent chat rail (`agentChatRail`)

`app/navigation-shell/app-dock.js` then computes:

- the visible dock apps and the **More** overflow menu (plugin workspaces always live there)
- responsive dock capacity based on viewport width
- which app to highlight for aliases like `assay`, `papers`, or `dna`

One subtle detail is that the dock tries to keep the active app visible even when the viewport is too narrow to show the full preferred dock order.

## View activation model

`showView(viewId)` in `app/navigation-shell.js` is the runtime switchboard for the shell.

It does more than toggle classes:

- normalizes aliased views
- remembers the last active view when startup settings allow it
- updates body classes for agent/sequence-viewer scrolling behavior
- keeps the dock, the overflow menu, and the agent chat rail (`navigation-shell/agent-rail.js`) in sync
- updates the page title and subtitle
- triggers view-specific re-renders only for the newly active module

Examples:

- opening `sample-registry-view` renders both the personal-inventory container workspace and the sample registry list, because those two modules share one workspace
- opening the special sequence-detail pseudo-view still highlights the **DNA** app in navigation
- opening `agent-view` rerenders only the agent UI instead of rerendering the whole app

`renderAll()` is the heavier path used after hydration or major state replacement. `showView()` is the lighter steady-state path.

## State replacement and persistence

The renderer core owns the shared `persist()` callback. It goes through the undo service (which records a checkpoint, coalescing edits to the same field) and then:

- normalizes storage paths
- writes `localStorage`
- when a storage root is set, auto-saves through `window.hikariApi.autoSaveDataFile(...)`, logging a warning if main reports `{ ok: false }`

That means feature modules usually mutate shared state directly and then call the shared `persist()` callback instead of owning their own storage layer.

## Main-process integration points

The renderer shell talks to the main process through `window.hikariApi`.

Key boot-time or shell-level calls include:

- `autoSaveDataFile(data, filePath)` — writes the compact snapshot and syncs the storage-root folders
- `importStorageRoot(storagePath)` — hydrates from a storage directory
- `ensureStorageDirectory(path)` / `pickStorageDirectory(currentPath)` — storage path setup
- `onProtocolRecordSaved(handler)` — protocols the agent saved (delegated to the protocol service)
- `onPaperFileSaved(handler)` — paper PDFs the agent downloaded (delegated to Papers)

Renderer state itself is loaded from `localStorage` (`loadState()` in `modules/app-state/index.js`), not from a bridge call. The full bridge surface is assembled in `src/main/preload/create-preload-api.js` from the per-domain `api/*.js` modules. For the main-process side of those calls, use [docs/main-platform/README.md](../../main-platform/README.md).
