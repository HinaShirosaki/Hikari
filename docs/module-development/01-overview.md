# 1. Architecture overview

This page is the mental model. Read it before touching code.

## The build pipeline

Source-of-truth layout under the project root:

```
ui/
  config/
    html-order.json        # shell fragments around generated views
    css-order.json         # shared styles before/after generated view styles
    app-registry.json      # canonical view order, ids, labels, icons, aliases
  html/
    shell/start.html       # everything before the first view
    shell/end.html         # everything after the last view
    views/<id>-view.html   # one fragment per view
  css/
    base/core.css          # design tokens, primitive elements
    themes/modes.css       # light/dark
    views/<id>-view.css    # per-view styles
    overrides/             # universal layouts (left-rail-template, menus, …)
src/renderer/
  bootstrap/index-shell.js # pre-app loading cover, theme application
  renderer.js              # browser entry; calls the core directly
  core/start-hikari-core.js # state, plugins, services, modules, navigation, search boot
  app/navigation-shell.js  # dock, view switching, page title
  app/topbar-open-handlers.js # search result open routing
  app/topbar-search.js
  app/plugin-*.js          # plugin loader, bridge, and service registry
  core/module-runtime.js   # manifest composition plus shared render dispatch
  module-manifests/        # per-module init/render declarations
  modules/                 # per-feature controllers
  services/                # cross-module fan-out (registry + services)
scripts/
  build-ui.mjs             # produces index.html, styles.css, generated JS
  build-ui/                # app-registry, html/css, and Codex provider builders
  check-dom-ids.mjs        # getElementById calls vs. the built index.html
  check-css-colors.mjs     # color literals only in *palette.css
  check-source-layout.mjs  # import boundaries
```

`npm run build:ui` runs `scripts/build-ui.mjs`, which:

1. Writes `src/main/generated/codex-model-catalog.generated.js` and `src/renderer/modules/codex-model-catalog.generated.js`: the Codex provider settings shared by direct features and Agent Chat. They list no models; the model list and default come from Codex at runtime.
2. Reads `ui/config/app-registry.json` and writes both `src/renderer/modules/app-registry.generated.js` and `src/renderer/modules/views.js`.
3. Uses `app-registry.json.viewOrder` to place each declared view between the shell fragments from `ui/config/html-order.json`, then writes `index.html`.
4. Inserts each declared view stylesheet between `prefixInputs` and `suffixInputs` from `ui/config/css-order.json`, then writes `styles.css`.
5. Validates registry keys/order (`viewOrder` must list every view once; `dockOrder` must match the dock apps), duplicate app ids/viewIds/viewKeys/icons, missing icon files, view files and section IDs, duplicate HTML IDs, and duplicate CSS paths.

If any check fails the build aborts. There is no fallback to "best effort." This means a broken module will not silently ship.

`npm start`, `npm test`, `npm run package:app`, and `npm run dist` all run `build:ui` first, so you cannot start Electron with stale generated files. The generated files are not committed.

## Renderer boot in one breath

Once Electron loads `index.html`:

1. `<script type="module" src="src/renderer/bootstrap/index-shell.js">` runs in `<head>`. It paints the loading cover, applies the saved appearance (font size, day/night) so first paint matches the user's last session, and listens for the `hikari:app-ready` event.
2. The body finishes parsing. All view `<section>`s are present in the DOM, but only `home-view` has `class="view is-active"` — everything else is hidden by `core.css` (`.view { display: none } .view.is-active { display: block }`).
3. `<script type="module" src="src/renderer/renderer.js">` runs at end of body. It installs a few global helpers (error reporting, icon captions, search fields, dialog layout) and calls `startHikariCore()` ([src/renderer/core/start-hikari-core.js](../../src/renderer/core/start-hikari-core.js)):
   - `loadState()` from localStorage (key `hikari_state_v1`).
   - Installs enabled plugins, so their views and registry entries exist before navigation is built.
   - Creates the **module registry** (a `Map`-based bus) and the **renderer services** (cross-module fan-out helpers).
   - Calls `createRendererModuleRuntime({...})` ([src/renderer/core/module-runtime.js](../../src/renderer/core/module-runtime.js)) which initializes manifest-declared modules from [src/renderer/module-manifests/](../../src/renderer/module-manifests/), registers each module with the registry, and builds route/boot render dispatch from manifest metadata.
   - Creates the **navigation shell**, which renders the dock from `APP_REGISTRY` and wires `showView()`.
   - Hydrates extra state from `window.hikariApi` if a storage path is set, runs `renderAll()`, then activates the startup view — or shows the first-launch **Choose Folder** page when no storage root is set.
   - Dispatches `hikari:app-ready`. The bootstrap cover fades out.

The full sequence is in [docs/renderer/architecture/boot-and-shell.md](../renderer/architecture/boot-and-shell.md).

## What "module" means here

Every entry in `APP_REGISTRY` corresponds to one view fragment and one controller. The controller is a plain function exported as `init<Name>(options)` that:

- looks up its DOM nodes by ID inside its own `<section id="...-view">`,
- attaches event listeners,
- exposes a small render API (e.g. `render()`, `renderList()`, `renderEntries()`),
- returns that API so [src/renderer/core/module-runtime.js](../../src/renderer/core/module-runtime.js) can call it during `renderAll()` and `renderView(viewId)`.

A module owns the DOM inside its `<section>`. It must not reach into another module's view. Cross-module communication happens through:

- the **module registry** (`registry.get('protocol').renderList?.()`),
- the **services layer** (`rendererServices.notebook.handleNotebookEntriesChanged()`),
- callbacks injected at init time (`onSamplesChanged`, `onOpenSampleRecorder`, …),
- the `window.hikariApi` IPC bridge (file system, scripts, agent calls).

Details on each: [03-module-contract.md](./03-module-contract.md).

## Universal HTML and CSS

The HTML shell (header, dock, topbar, workspace container) and the design tokens, layout primitives, and shared overrides in `ui/css/base/`, `ui/css/themes/`, and `ui/css/overrides/` apply globally. A new module **inherits**:

- the topbar with its dock, more-menu, page title, and search input;
- the workspace container that swaps active views;
- core typography and color tokens (`--accent`, `--surface`, `--line`, `--text`, …);
- the `.view`, `.panel`, `.tile`, `.primary-btn`, `.ghost-btn`, `.small-note`, `.form-grid`, `.list-row` primitives;
- the `left-rail-template` layout for two-pane (rail + content) workspaces;
- `[data-sync-left-rail]` for shared rail width sync across views.

You write only the markup specific to your view. The next page covers exactly which classes to lean on. See [02-html-and-css.md](./02-html-and-css.md).

## State and persistence

There is one mutable state object created by `loadState()` and passed to every module by reference. Mutations happen in-place; persistence is explicit via the `persist()` callback (writes localStorage and, if `state.settings.storagePath` is set, autosaves to disk through `window.hikariApi.autoSaveDataFile`).

`defaultState` in [src/renderer/modules/app-state/defaults.js](../../src/renderer/modules/app-state/defaults.js) defines every top-level key; [state-normalizer.js](../../src/renderer/modules/app-state/state-normalizer.js) assembles loaded state. If your module needs a new top-level field, update both with a sensible default.

## What the dock and navigation give you

When you add an entry to `app-registry.json`, the navigation shell automatically:

- renders a dock button (or a "More" menu item if `placement: "more"`);
- highlights the button when its view is active;
- updates the page title in the topbar from `app.label`;
- updates the page subtitle from `TITLES[viewId]`;
- routes topbar search to your view if `searchInputId` is set;
- registers `aliases[]` so the topbar search command bar can navigate to your view by name.

You do not write navigation code. You declare it.

## Where to go next

- [02-html-and-css.md](./02-html-and-css.md) for the markup and styling contract.
- [03-module-contract.md](./03-module-contract.md) for the JS init contract.
- [04-adding-a-new-module.md](./04-adding-a-new-module.md) for the recipe.
