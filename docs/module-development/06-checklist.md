# 6. Checklist, conventions, and build-time validations

A condensed checklist plus the conventions and rules the build enforces.

## Pre-flight checklist

Before you call your module done, verify all of the following.

### Files

- [ ] `ui/html/views/<id>-view.html` exists.
- [ ] `<section id="<id>" class="view">` is the single top-level node in the fragment.
- [ ] `ui/css/views/<id>-view.css` exists. All selectors are scoped under `#<id>`.
- [ ] `assets/icons/<icon>.svg` exists, 24×24 viewBox, line-style.

### Configuration

- [ ] `ui/config/app-registry.json` lists the new app entry and its `viewKey` in `viewOrder`.
- [ ] If `placement: "dock"`, the id is also added to `dockOrder[]` in the same file.

### Renderer wiring

- [ ] `src/renderer/modules/views.js` contains the generated `VIEWS` and `TITLES` entry after `build:ui`.
- [ ] `src/renderer/modules/app-state/defaults.js` — optional entry in `STARTUP_DEFAULT_VIEW_IDS`, plus a top-level default; update `state-normalizer.js` if your module owns persisted data.
- [ ] `src/renderer/modules/<id>/index.js` exists and exports `init<Name>`.
- [ ] `src/renderer/module-manifests/<id>.js`:
  - [ ] imports `init<Name>`,
  - [ ] sets `key` to the registry key,
	  - [ ] builds the module options in `createOptions(...)`,
	  - [ ] adds `viewKey` plus `render(...)` for navigation rendering,
	  - [ ] (optional) adds `bootOrder` for boot-time rendering,
	  - [ ] (optional) adds `renderAll(...)` when the boot render differs from `render(...)`.
- [ ] `src/renderer/module-manifests/index.js` exports the manifest in the correct initialization group.

### Cross-module

- [ ] If other modules need to react when your data changes, you added/extended a service in `src/renderer/services/` and passed it through your manifest options.
- [ ] You did not import another feature module's internals directly.

### Build and run

- [ ] `npm run build:ui` succeeds and prints all five output paths.
- [ ] `npm test` passes (`build:ui` + `check:dom-ids` + `node test.js`).
- [ ] `npm start` boots the app, the dock button shows, the view renders, and reload preserves state.

## Naming conventions

| Thing | Convention | Example |
| --- | --- | --- |
| View id | `<kebab-feature>-view` | `my-feature-view` |
| `VIEWS` constant | `SCREAMING_SNAKE` | `MY_FEATURE` |
| Init function | `init<PascalName>` | `initMyFeature` |
| Module entry | folder `<kebab-feature>/index.js` | `my-feature/index.js` |
| Module registry key | `camelCase` matching the module name | `myFeature` |
| State slice | plural-noun camelCase under `state.` | `state.myFeatureItems` |
| DOM ids inside view | `<kebab-feature>-<purpose>` | `my-feature-list`, `my-feature-add-btn` |
| Dock app id | `<kebab-feature>` | `my-feature` |
| Dock label | Title Case for menu | `My Feature` |
| Dock icon | `<kebab-feature>.svg` | `my-feature.svg` |
| CSS class root | `<kebab-feature>-` | `.my-feature-rail` |

Keep the same root noun across all the names. It dramatically reduces the cognitive cost of finding things later.

## Build-time validations you should know about

`scripts/build-ui.mjs` ([source](../../scripts/build-ui.mjs)) enforces:

- View files contain `<section id="<id>"` matching the config entry. *Error:* `View file ... does not contain expected section id`.
- No duplicate `id="..."` attributes anywhere in the concatenated HTML. *Error:* `Duplicate HTML id attributes detected: id1 (2), id2 (2)`.
- No duplicate shared or generated CSS paths. *Error:* `Duplicate CSS input entry`.
- Every dock app has its id in `dockOrder`, and every id in `dockOrder` exists. *Errors:* `dockOrder references unknown app id`, `App "x" is placed in the dock but missing from dockOrder`, `dockOrder length must match the number of apps with placement "dock"`.
- `app-registry.json` entries are well-formed (id, label, viewId, icon, placement among `dock` / `more`).

`scripts/check-dom-ids.mjs` enforces:

- IDs referenced in the renderer JS exist in the generated HTML, and vice versa. Catches typos before they hit users.

`npm test` runs both, plus `node test.js`.

## Common mistakes and how the build complains

| Symptom | Likely cause |
| --- | --- |
| Build error `Duplicate HTML id attributes` | another view or shell uses the same id; namespace yours |
| Build error `View file ... does not contain expected section id` | typo between `app-registry.json` and the `<section>` id |
| `npm start` boots, button shows, view stays blank | manifest `viewKey`/`render` is missing, or the init function was added but never exported from `module-manifests/index.js` |
| Click the dock button — page title updates but the view stays empty | The registry view fragment does not have `class="view"`, or the renderer core's startup `showView()` resolves to a different id |
| State survives reload but other modules don't refresh after edits | You forgot to call the injected `on…Changed()` callback after `persist()` |
| Other modules update fine, yours doesn't refresh after their edits | Their service callback list (e.g. `protocolService.handleProtocolsChanged`) does not call your module — extend the service |
| Topbar search behaves oddly | An alias in `app-registry.json` collides with another app's alias; aliases are matched globally |

## When to split a module into a folder

Trigger any one of these and migrate to a folder layout (per [03-module-contract.md](./03-module-contract.md)):

- File is over ~400 lines.
- The file mixes pure helpers (no DOM) with DOM wiring.
- You see repeated `inventorySections.querySelectorAll('[data-...]').forEach(...)` patterns — split events into `events.js`.
- You start passing the same five locals into many helper functions — they belong in a closure exported from `state.js`.

The two most useful examples to mimic:

- [src/renderer/modules/personal-inventory/](../../src/renderer/modules/personal-inventory/) — `index.js` + `state.js` + `detail-rendering.js` + `constants.js` + `Readme.md`.
- [src/renderer/modules/home-dashboard/](../../src/renderer/modules/home-dashboard/) — one widget per file, an orchestrator that fans render() to all widgets.

## Documentation expectations

- A short `Readme.md` inside the module folder explaining file responsibilities is enough for most modules.
- Cross-module behavior (what `on…Changed` triggers, who else listens) is documented in the service file at the top.
- If you add a new top-level state slice or change `defaultState`, add a one-line note to [docs/renderer/architecture/state-services-and-search.md](../renderer/architecture/state-services-and-search.md).

## Performance posture

The renderer has no virtual DOM. Re-render is `innerHTML = ...` followed by re-binding listeners on the new DOM. That's fine for view-scoped renders (tens to low-thousands of nodes) and is the established pattern. If your render becomes janky:

- Render only the affected sub-region (`renderList()`, not full `render()`).
- Cache derived data on `uiState` so render is purely "data → markup" without recomputation.
- Avoid `safeText` chains in hot loops by caching escaped strings on the data object after normalization.

Don't reach for a framework. Match the surrounding patterns.

## Summary

A module is a view fragment, stylesheet, icon, folder entry, registry declaration, and manifest. The build-time checks catch the easy mistakes. The registry/service layer keeps modules from coupling. Read [03-module-contract.md](./03-module-contract.md) for the JS contract, [05-cross-module-and-services.md](./05-cross-module-and-services.md) for cross-module patterns, and follow the recipe in [04-adding-a-new-module.md](./04-adding-a-new-module.md).
