# 5. Cross-module communication, services, and IPC

This page is the field guide for "I am inside module A, I need to do something in / about module B."

## Decision tree

> Start here when in doubt.

```
Is this a one-shot navigation? ("open the notebook on entry X")
  → callback injected at init time:
        onOpenNotebookEntry: (id) => { showView(...); modules.biologyNotebook.openEntry(id); }

Did data my module owns change, and other modules display it?
  → fire a service callback:
        onMyFeatureChanged: rendererServices.protocol.handleProtocolsChanged
    The service knows the fan-out list. Your module doesn't.

Do I need to look up data another module computes (not just persisted state)?
  → registry.get('<key>').<method>?.()
    Used inside service files. Avoid from inside a module.

Do I need to read or mutate persisted data?
  → read/write state directly, then call persist().
    Don't channel data through services.

Do I need filesystem, native dialog, agent call, scripts, autosave?
  → window.hikariApi (passed in as apiBridge / getApiBridge).
```

The full set of helpers used by existing modules is below.

## The module registry

```js
// src/renderer/services/module-registry.js
const registry = createModuleRegistry({ showView, setSearchInputValue, VIEWS, ... });
registry.register('myFeature', myFeatureApi);
const protocol = registry.get('protocol');
```

`get` always returns an object — the empty frozen sentinel `EMPTY_ENTRY` if the key is unknown — so optional chaining is safe:

```js
registry.get('biologyNotebook').renderEntries?.();
```

The pre-seeded keys (passed in by the renderer core as `uiBridge`):

| Key | Value |
| --- | --- |
| `showView` | `(viewId) => void`, used by services that need to navigate |
| `setSearchInputValue` | `(inputId, value) => boolean`, used to drive in-view search inputs |
| `VIEWS` | the `VIEWS` constants map |

After init, every module is also registered under its own key. Current keys: `biologyNotebook`, `protocol`, `agentChat`, `agentChatRail`, `workflowManagement`, `papers`, `labCommonInventory`, `personalInventory`, `sampleRegistry`, `assay`, `sequenceViewer`, `toolBox`, `settings`, `homeDashboard`.

When **inside** a feature module, prefer the injected callback over `registry.get(...)`. The registry exists so service files can fan out without each module knowing about the others.

## The service layer

The service layer is the glue you should reach for whenever a change in one module must be reflected somewhere else. Files live in [src/renderer/services/](../../src/renderer/services/):

| Service | Methods (examples) |
| --- | --- |
| `protocolService` | `handleProtocolsChanged()`, `handleProtocolsImported()`, `handleExternalProtocolRecordSaved(payload)`, `openProtocol(id)`, `importProtocolsFromJson(json, opts)`, `createDraftFromPaper({method, paper})` |
| `notebookService` | `handleNotebookEntriesChanged()`, `handleAgentNotebookEntriesChanged()` |
| `projectService` | `handleProjectsChanged()` |
| `inventoryService` | `handleSamplesChanged()`, `openSampleSearch(query)` |
| `analysisService` | `handleAssaysChanged()`, `openAssayForNotebook(...)` |
| `sequenceService` | `openFromToolBox(seq)` |

Each service is a closure over the registry. A typical implementation:

```js
// src/renderer/services/protocolService.js
export function createProtocolService(registry) {
  function handleProtocolsChanged() {
    registry.get('biologyNotebook').renderProtocolOptions?.();
    registry.get('biologyNotebook').renderEntries?.();
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
  }
  return { handleProtocolsChanged, ... };
}
```

You hand the service callback to a module at init time, and it calls it after mutations:

```js
// in a module manifest
export const myFeatureManifest = {
  key: 'myFeature',
  createOptions: ({ state, persist, createId, safeText, rendererServices }) => ({
    state, persist, createId, safeText,
    onMyFeatureChanged: rendererServices.protocol.handleProtocolsChanged
  })
};
```

```js
// inside protocol/index.js
function saveProtocol(...) {
  // mutate state.protocols
  persist();
  onProtocolsChanged?.();
}
```

This keeps each module ignorant of who else cares about its data.

### Adding a new service

1. New file `src/renderer/services/myAreaService.js` exporting `createMyAreaService(registry)`.
2. Re-export from `src/renderer/services/index.js` and add to `createRendererServices` return value.
3. Pass the desired methods into modules from their manifest `createOptions(...)` hook.

Keep services thin — they should call `registry.get('<other>').<method>?.()` and nothing more. Business logic belongs in the module that owns the data.

## Persisted state vs. transient UI state

| Goes in `state` | Stays in module locals |
| --- | --- |
| User-authored data (entries, items, settings) | "is dialog open" |
| Cross-module references (foreign keys) | "currently selected row id" (unless you want it remembered across reloads) |
| Configuration the user expects to survive a reload | Draft text the user is still typing |

If unsure, ask: *"If the user reloads, do they expect this back?"* If yes, `state`. If no, locals.

Projects are a good ownership example: their records remain in `state.projects`, while creation and project dashboards live under `modules/biology-notebook/project/`. Other features resolve project IDs from shared state and use `projectService.handleProjectsChanged()` for rerender fan-out; there is no parallel `projectManagement` module or relationship-graph store.

## The IPC bridge: `window.hikariApi`

Anything that touches the OS or main process goes through the preload-injected `window.hikariApi`. In modules, accept it as `apiBridge` / `getApiBridge` rather than referencing `window` directly.

Common methods (full surface in [docs/main-platform/](../main-platform/)):

| Method | Purpose |
| --- | --- |
| `autoSaveDataFile(state, manifestPath?)` | autosave the state bundle (called from the renderer core's `persist`) |
| `loadDataFile()` / `saveDataFile(state)` | manual import/export of the `.json` snapshot |
| `runScript(name, payload)` | invoke a registered main-process script (used by tool-box, agent) |
| `openExternalUrl(url)` | shell-open a URL |
| `selectStorageRoot()` | open the directory picker for `Settings → Storage Path` |
| Storage bundle import/export | see [src/renderer/app/storage-import.js](../../src/renderer/app/storage-import.js) and [src/main/storage/](../../src/main/storage/) |
| Agent calls | `callAgent`, `streamAgent`, `cancelAgent`, … (see [docs/agent/](../agent/)) |

Use it via the bridge passed to your module:

```js
export function initMyFeature({ getApiBridge, ... }) {
  async function exportFile() {
    const bridge = getApiBridge();
    if (!bridge?.saveDataFile) {
      return;
    }
    await bridge.saveDataFile(state);
  }
}
```

Always optional-chain. The bridge is `null` in renderer test harnesses or when running in a browser tab.

## Custom DOM events

Three custom events broadcast from the renderer app shell:

| Event | When | Listened by |
| --- | --- | --- |
| `hikari:app-ready` | after `initApp()` finishes (or fails) | `bootstrap/index-shell.js` (drops the loading cover), tests |
| `hikari:appearance-changed` | when `Settings` writes new appearance | `navigation-shell.js` (re-renders active view to pick up theme) |
| `hikari:storage-path-changed` | when storage path is saved | `app/storage-import.js` |

If your module needs to listen, attach to `window` and remember to remove the listener if you ever support hot-reload.

## Topbar search routing

The topbar search command bar (see [src/renderer/app/topbar-search.js](../../src/renderer/app/topbar-search.js)) routes queries to feature views. If your view has a useful search/filter input, expose its DOM id via `searchInputId` in `app-registry.json` and the topbar will route queries to it through `setSearchInputValue(inputId, value)`. No code in your module is required.

## Anti-patterns

- **Importing another feature module's internal helpers.** Your module should not `import { … } from './biology-notebook.js'`. Use the registry/service layer.
- **Creating a parallel module for another feature's state slice.** Extend the existing owner and expose a callback, service method, or public API instead.
- **Direct DOM access into another view's nodes** (e.g. `document.querySelector('#protocol-list')`). The other module owns its DOM. Use its render API.
- **Throttled persistence inside a module.** `persist()` already accounts for the autosave path; calling it eagerly is correct.
- **Skipping `safeText` when building innerHTML.** All user-supplied strings flow through `safeText` to avoid HTML injection. Keep that pattern even when the string "looks safe."
- **Re-fetching the bridge** (`window.hikariApi`) inside a hot loop. Capture once at init or use the `getApiBridge()` factory exactly when you need it.
