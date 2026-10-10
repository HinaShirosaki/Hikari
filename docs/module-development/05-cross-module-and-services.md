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

Do I need filesystem, native dialog, agent call, LLM prompt, Python, autosave?
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

After init, every module is also registered under its own key. Current keys: `biologyNotebook`, `protocol`, `agentChat`, `agentChatRail`, `workflowManagement`, `papers`, `labCommonInventory`, `personalInventory`, `assay`, `sequenceViewer`, `toolBox`, `settings`, `homeDashboard`.

When **inside** a feature module, prefer the injected callback over `registry.get(...)`. The registry exists so service files can fan out without each module knowing about the others.

## The service layer

The service layer is the glue you should reach for whenever a change in one module must be reflected somewhere else. Files live in [src/renderer/services/](../../src/renderer/services/):

| Service | Methods (examples) |
| --- | --- |
| `protocolService` | `handleProtocolsChanged()`, `handleProtocolsImported()`, `handleExternalProtocolRecordSaved(payload)`, `saveProtocolRecord(...)`, `openProtocol(id)`, `importProtocolsFromJson(json, opts)`, `createDraftFromPaper({method, paper})` |
| `notebookService` | `handleNotebookEntriesChanged()`, `handleAgentNotebookEntriesChanged()`, `logPageEvent(...)` |
| `projectService` | `handleProjectsChanged()`, `ensureProjectRecord(...)` |
| `inventoryService` | `handleSamplesChanged()`, `handleSampleInventorySettingsChanged()`, `openSampleSearch(query)` |
| `analysisService` | `handleAssaysChanged()`, `openAssayForNotebook(...)` |
| `sequence` (`modules/sequence-viewer/service.js`) | `openFromToolBox(seq)` |

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

The surface is one spread per domain, built in `src/main/preload/create-preload-api.js` from `src/main/preload/api/*.js`. The methods modules use most:

| Area | Methods |
| --- | --- |
| Storage root and snapshot | `autoSaveDataFile(state, filePath)` (called from the renderer core's `persist`), `importStorageRoot(path)`, `pickStorageDirectory(current)`, `ensureStorageDirectory(path)`, `getLastStorageRoot()` |
| Files in the storage root | `storeImportedFile(...)`, `moveStoredFile(...)`, `writeJsonFile(...)`, `readFileBytes(path)`, `readFileBase64(path)`, `openFilePath(path)`, `appendNotebookPageLog(...)` |
| Import parsers | `parseChemicalImportFile(...)`, `parseAssayResultImportFile(...)` |
| Sequence library | `sequenceLibraryList`, `sequenceLibraryGet`, `sequenceLibraryUpsert`, `sequenceLibrarySearchFeatures`, … |
| LLM and agent | `runDirectLlmPrompt(...)` (through `services/direct-llm.js`), `agentChat(...)`, `agentChatCancel(...)`, `onAgentProgress(handler)`, `agentGenerateProtocol(...)` (see [docs/agent/](../agent/)) |
| Scheduled tasks | `listScheduledTasks`, `createPaperFindingTask`, `schedulePaperFinding`, … |
| System | `openExternalUrl(url)`, `openLogsFolder()`, `reportError(...)`, `runPython({ code, files, readback_paths })` |
| Clipboard | `readChemicalClipboard()`, `writeTextToClipboard(text)` |

The main-process side of each group is in [docs/main-platform/ipc/ipc-registrars.md](../main-platform/ipc/ipc-registrars.md). Most methods resolve `{ ok: false, error }` instead of throwing, so check the result.

Use it via the bridge passed to your module:

```js
export function initMyFeature({ getApiBridge, ... }) {
  async function saveResult(result) {
    const bridge = getApiBridge();
    if (!bridge?.writeJsonFile) {
      return;
    }
    const saved = await bridge.writeJsonFile({
      storagePath: state.settings.storagePath,
      targetFolder: 'MyFeature',
      fileName: 'result.json',
      data: result
    });
    if (saved?.ok === false) {
      showTransientNotice(saved.error, { type: 'error' });
    }
  }
}
```

Always optional-chain. The bridge is `null` in renderer test harnesses or when running in a browser tab.

## Custom DOM events

Custom events broadcast on `window`:

| Event | When | Listened by |
| --- | --- | --- |
| `hikari:app-ready` | after `initApp()` finishes (or fails) | `bootstrap/index-shell.js` (drops the loading cover), tests |
| `hikari:appearance-changed` | when `Settings` writes new appearance | `navigation-shell.js` (reapplies the theme), the plugin bridge (forwards it to plugin frames) |
| `hikari:storage-changed` | when a storage root is opened or saved | the plugin bridge (forwards it to plugin frames) |
| `hikari:left-rail-width-changed` | when the shared left rail is resized or collapsed | the plugin bridge (`layout` context) |
| `hikari:open-agent-chat-rail` / `hikari:close-agent-chat-rail` | a view asks the shell to open or close its agent side rail | `navigation-shell/agent-rail.js` |
| `hikari:agent-chat-rail-state`, `hikari:agent-chat-rail-availability-changed` | the rail opened/closed, or a view's rail availability changed | views that mirror the rail state (e.g. Papers workspace controls) |

If your module needs to listen, attach to `window` and remember to remove the listener if you ever support hot-reload.

## Topbar search routing

The topbar search command bar (see [src/renderer/app/topbar-search.js](../../src/renderer/app/topbar-search.js)) routes queries to feature views. If your view has a useful search/filter input, expose its DOM id via `searchInputId` in `app-registry.json` and the topbar will route queries to it through `setSearchInputValue(inputId, value)`. No code in your module is required.

## Anti-patterns

- **Importing another feature module's internal helpers.** Your module should not `import { … } from '../biology-notebook/notebook/save-entry.js'`. Use the registry/service layer, or the feature's `public-api.js` if it has one. `npm run check:source-layout` fails on some of these (Agent Chat and Tool Box internals, cross-feature cycles).
- **Creating a parallel module for another feature's state slice.** Extend the existing owner and expose a callback, service method, or public API instead.
- **Direct DOM access into another view's nodes** (e.g. `document.querySelector('#protocol-list')`). The other module owns its DOM. Use its render API.
- **Throttled persistence inside a module.** `persist()` already accounts for the autosave path; calling it eagerly is correct.
- **Skipping `safeText` when building innerHTML.** All user-supplied strings flow through `safeText` to avoid HTML injection. Keep that pattern even when the string "looks safe."
- **Re-fetching the bridge** (`window.hikariApi`) inside a hot loop. Capture once at init or use the `getApiBridge()` factory exactly when you need it.
