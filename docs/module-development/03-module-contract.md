# 3. The module contract

Every module is a JavaScript factory that takes an options bag, performs DOM lookups, attaches event listeners, and returns a small render API. This page documents the contract precisely so you can write a new module without copy-paste guesswork.

## File location and shape

New user-facing features use a folder entry:

```
src/renderer/modules/my-feature/
  index.js          # exports initMyFeature, orchestrates submodules
  state.js          # pure state-derived helpers (no DOM)
  rendering.js      # markup builders / fragment renderers
  events.js         # event wiring (optional)
  constants.js      # labels, defaults
  Readme.md         # short maintenance note
```

[src/renderer/modules/personal-inventory/](../../src/renderer/modules/personal-inventory/) and [src/renderer/modules/home-dashboard/](../../src/renderer/modules/home-dashboard/) are good references. [src/renderer/modules/tool-box.js](../../src/renderer/modules/tool-box.js) plus [src/renderer/modules/tool-box/](../../src/renderer/modules/tool-box/) is a legacy composition-root pattern, not the default for new views.

The feature entry exports a single function named `init<Name>` (camel-cased, capitalized after `init`):

```js
// src/renderer/modules/my-feature/index.js
export function initMyFeature(options) { ... }
```

Manifests import `init*` directly from `modules/my-feature/index.js`. Add a secondary `public-api.js` only when pure helpers intentionally have consumers beyond the view entry.

## The `init*` function: inputs

Modules get their options bag from a manifest in `src/renderer/module-manifests/`. `module-runtime.js` composes those manifests and supplies the same context to every declaration. The full set of common inputs (you destructure what you need):

| Option | Type | Source | Meaning |
| --- | --- | --- | --- |
| `state` | object | `loadState()` | the single mutable state object — mutate in place, then call `persist()` |
| `persist` | `() => void` | renderer core | flushes state to localStorage and disk; rebuilds `state.objectGraph` |
| `createId` | `() => string` | `utils.js` | timestamp+random ID generator for new entities |
| `safeText` | `(value) => string` | `utils.js` | HTML-escape helper, use whenever you build innerHTML |
| `cssEscape` | `(value) => string` | `utils.js` | escapes a value for use inside a CSS attribute selector |
| `notebookType` | string | constant per call site | e.g. `'biology'` for the notebook module |
| `apiBridge` | object \| null | `window.hikariApi` | IPC bridge exposed by the preload script |
| `getApiBridge` | `() => object \| null` | factory | use this if you may need the bridge after lazy initialization |
| `rootDocument` | Document | `globalThis.document` | useful when supporting iframes or off-screen render in tests |
| `selectionInsightsController` | object | `selection-insights.js` | optional: text selection insights service |
| `trackGrowthEvent` | function | `app-state.js` | append a growth event to `state.growthMetrics` |
| `onXxxChanged` | function | `rendererServices.<area>` | the **important** one: cross-module fan-out callbacks (see below) |
| `onOpen<Other>` | function | renderer core | navigation/launch callbacks (e.g. `onOpenNotebookEntry`) |

Look at [src/renderer/module-manifests/assay.js](../../src/renderer/module-manifests/assay.js) or [src/renderer/module-manifests/project-management.js](../../src/renderer/module-manifests/project-management.js) for the preferred wiring shape. If your module needs several other modules to already exist, put that dependency in the manifest `createOptions` callback; the runtime passes the shared `modules` object after each group is initialized.

A typical module signature:

```js
export function initMyFeature({
  state,
  persist,
  createId,
  safeText,
  onMyFeatureChanged = () => {}
}) {
  // 1. DOM lookups
  const root = document.getElementById('my-feature-view');
  const list = document.getElementById('my-feature-list');
  if (!root || !list) {
    return { render: () => {} };  // gracefully no-op if wiring is missing
  }

  // 2. Local UI state (NOT in the persisted state object)
  const uiState = {
    selectedId: '',
    isAddFormOpen: false
  };

  // 3. Render API
  function render() {
    const items = state.myFeatureItems || [];
    list.innerHTML = items.map((item) => `
      <li class="list-row" data-id="${safeText(item.id)}">
        <span>${safeText(item.name)}</span>
      </li>
    `).join('');
  }

  // 4. Event wiring
  list.addEventListener('click', (event) => {
    const row = event.target instanceof Element ? event.target.closest('[data-id]') : null;
    if (!row) return;
    uiState.selectedId = row.dataset.id || '';
    render();
  });

  // 5. Public API
  return {
    render
  };
}
```

The shape of the returned API is not constrained; it is whatever `module-runtime.js` and other modules need to call. Common conventions:

- `render()` — full render of the view.
- `renderList()`, `renderEntries()`, `renderForm()`, `renderOptions()` — fine-grained refresh hooks called by services after data changes elsewhere.
- `applyAppearance()` — re-applies any per-view style based on `state.settings.appearance`.
- `openEntry(id)` — public navigation hook so other modules can launch into a specific record.

## Defensive lookups

The renderer is one big DOM. Always check elements exist before calling `addEventListener` etc:

```js
const button = document.getElementById('my-feature-add-btn');
button?.addEventListener('click', onAdd);
```

The reason is twofold: ID typos surface as silent breakage in unit-test environments, and `module-runtime.js` instantiates every module on every boot regardless of which view you start in.

If a critical element is missing, return a no-op API as in `home-dashboard.js`:

```js
if (requiredElements.some((element) => !element)) {
  return { render: () => {} };
}
```

This keeps `renderAll()` safe.

## State contract

There is one state object. It is loaded through the stable [app-state.js](../../src/renderer/modules/app-state.js) facade, normalized in [app-state/state-normalizer.js](../../src/renderer/modules/app-state/state-normalizer.js), and reused for the entire app lifetime. Every module receives **the same reference**.

Rules:

1. **Mutate in place.** `state.myFeatureItems.push(item)`, not `state = { ...state, myFeatureItems: [...] }`.
2. **Call `persist()` after every user-visible change.** It writes localStorage and triggers `autoSaveDataFile` if a storage path is configured. Do not throttle it inside a module — the renderer core already swallows the auto-save promise.
3. **Add new top-level keys to `defaultState`.** Otherwise users who upgrade have `undefined` until they touch your view. Defaults live in [src/renderer/modules/app-state/defaults.js](../../src/renderer/modules/app-state/defaults.js).
4. **Keep transient UI state in module locals**, not on `state`. The `selectedRowId`, "is dialog open", "draft text", etc. should never leave the module. The persisted `state` is for data the user expects back next session.
5. **Never write to `state.objectGraph`.** It is rebuilt on every `persist()` from the rest of the state by [src/renderer/modules/object-graph.js](../../src/renderer/modules/object-graph.js).

If your module reads data that lives under another module's domain (e.g. `state.protocols` from inside the notebook), read it directly. Don't try to channel it through service calls — the state object **is** the source of truth.

## Cross-module communication

Three mechanisms, used in this order of preference.

### 3.1 Service fan-out (recommended)

When data your module changes is also displayed elsewhere (e.g. a sample edit must refresh the notebook entry list), call into the appropriate **service** at renderer-core injection time:

```js
// in your module manifest:
initMyFeature({
  state,
  persist,
  ...
  onMyFeatureChanged: rendererServices.protocol.handleProtocolsChanged
})
```

Inside the module you only call `onMyFeatureChanged()`. You don't know (or care) which other modules are subscribed.

The services are defined in [src/renderer/services/](../../src/renderer/services/):

- `protocolService.js` — `handleProtocolsChanged`, `handleProtocolsImported`, `handleExternalProtocolRecordSaved`, `openProtocol`, `importProtocolsFromJson`, `createDraftFromPaper`
- `notebookService.js` — `handleNotebookEntriesChanged`, `handleAgentNotebookEntriesChanged`
- `projectService.js` — `handleProjectsChanged`
- `inventoryService.js` — `handleSamplesChanged`, `openSampleSearch`
- `analysisService.js` — `handleAssaysChanged`, `handleGelAnalysesChanged`, `openAssayForNotebook`, `openGelForNotebook`
- `modules/sequence-viewer/service.js` — `openFromToolBox` (destination-owned handoff service)

Add a new service file for a new feature area. The shape is mechanical — see [src/renderer/services/protocolService.js](../../src/renderer/services/protocolService.js):

```js
export function createProtocolService(registry) {
  function handleProtocolsChanged() {
    registry.get('biologyNotebook').renderProtocolOptions?.();
    registry.get('biologyNotebook').renderEntries?.();
    registry.get('workflowManagement').render?.();
    // ...
  }
  return { handleProtocolsChanged, /* ... */ };
}
```

Then export it in `services/index.js` so `createRendererServices` exposes it.

### 3.2 Module registry

If you only need to call **one** other module:

```js
const protocol = registry.get('protocol');
protocol.renderList?.();
```

`registry.get` always returns an object (the empty frozen sentinel `{}` if missing), so optional chaining is enough. The keys come from `manifest.key`. Current keys:

```
biologyNotebook, protocol, projectManagement, agentChat, workflowManagement,
papers, labCommonInventory, personalInventory, sampleRegistry, assay, gel,
sequenceViewer, toolBox, settings, homeDashboard
```

You usually only reach for the registry inside service files. From inside your module, prefer the injected callback (see 3.1).

### 3.3 IPC bridge (`window.hikariApi`)

For anything that crosses the renderer/main boundary — file system, agent calls, scripts, autosave, native dialogs — use the `apiBridge`/`getApiBridge` option:

```js
const bridge = getApiBridge();
const result = await bridge?.runScript?.('extract-feature', payload);
```

The full surface is documented in [docs/main-helpers/](../main-helpers/). Don't import directly from `window` in modules — accept it through the options bag so the module stays testable.

## Lifecycle and rendering

The renderer runtime always initializes your module on boot, and renders it during `renderAll()` when its manifest declares a `bootOrder`:

1. `initMyFeature(options)` — synchronous, registers DOM listeners.
2. `modules.myFeature.render()` or `renderAll()` — your manifest's boot render dispatcher after the state is fully hydrated.

After boot, your module re-renders in response to:

- the user navigating to your view: `renderView(viewId)` looks up the manifest-declared route and calls the appropriate render function.
- a service callback firing, e.g. another module calls `onSamplesChanged()` and `inventoryService.handleSamplesChanged` ends up calling your `renderList?.()`.
- direct user interaction: your own listeners call `render()` after mutating state and `persist()`.

There is no virtual DOM and no reactive system. You decide when to re-render. Keep `render()` idempotent and cheap enough to call after any state change.

## Returning the API

The runtime stores whatever you return under `modules.<key>` and registers it under the same key with the registry. Other modules and services then reach back through `registry.get('<key>')`. Keep the returned object small and stable — adding a method is fine; renaming one is a breaking change for anyone using the registry.

## When you really need a new top-level concept

If your feature introduces a brand new top-level state slice (say `state.experiments`), make sure to:

1. Add the default to `defaultState` in `app-state/defaults.js`.
2. Extend `normalizeState()` to coerce missing/legacy values.
3. Add the slice to the object graph if it has cross-references — see [src/renderer/modules/object-graph.js](../../src/renderer/modules/object-graph.js).
4. If the slice should round-trip to the on-disk `.ena` storage bundle, hook the writer in [src/renderer/app/storage-import.js](../../src/renderer/app/storage-import.js) and the matching main-process bundler in [src/main/helpers/main/storage-bundle/](../../src/main/helpers/main/storage-bundle/).

Most modules do not need this. Reuse existing slices when you can.
