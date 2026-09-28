# Module Map

This is a quick lookup map for `src/renderer`.

Every user-facing feature is a **folder module** (`modules/<feature>/index.js`) registered through `module-manifests/`. The `modules/` root contains only generated files (`views.js`, `app-registry.generated.js`, `codex-model-catalog.generated.js`); pure cross-feature code lives in `lib/`, integration adapters live in `services/`, and shell code lives in `app/`.

## Legend

- `Main path`: directly involved in renderer boot or shell behavior
- `Feature entry`: main entry file for a user-facing workspace (manifest-registered)
- `Cross-cutting`: shared runtime helper used by many features
- `Support`: wrapper, dataset, export helper, or secondary utility

## Renderer boot and shell

| File | Status | Notes |
| --- | --- | --- |
| `bootstrap/index-shell.js` | Main path | restores the saved appearance before the main module loads |
| `renderer.js` | Main path | browser-side script entry: installs error reporting, icon captions, search fields, and dialog layout, then calls the renderer core |
| `core/start-hikari-core.js` | Main path | renderer core: state, plugins, services, modules, navigation, search, hydration, persistence |
| `core/module-runtime.js`, `core/manifest-runtime.js` | Main path | composes manifest-declared modules, fences each module's init/render, and builds route/boot render dispatch from manifest metadata |
| `module-manifests/` | Main path | per-module init/render declarations grouped by feature family; each manifest is loaded in isolation |
| `app/navigation-shell.js` + `app/navigation-shell/` | Main path | `showView`, startup view, the dock and **More** menu, search suggestions, and the agent chat rail |
| `app/topbar-search.js` + `app/topbar-search/` | Main path | topbar search commands, aliases, candidates, and scoring |
| `app/topbar-open-handlers.js` | Main path | topbar search result open routing for domain records |
| `app/storage-import.js`, `app/storage-import-merge.js` | Main path | storage-root hydration and merge into renderer state |
| `app/storage-setup.js` | Main path | the first-launch **Choose Folder** workspace page |
| `app/plugin-loader.js`, `app/plugin-bridge.js` + `app/plugin-bridge/`, `app/plugin-services.js`, `app/plugin-origin.js` | Main path | plugin install, the permission-gated `postMessage` bridge, and the service-plugin registry |
| `app/shared-left-rail.js` | Cross-cutting | resizable/collapsible left rails shared by every workspace |
| `app/appearance.js`, `app/dialog-layout.js`, `app/icon-button-captions.js`, `app/error-reporting.js` | Cross-cutting | theme application, dialog placement, icon-button captions, renderer error forwarding |

## Shared services

| File | Status | Notes |
| --- | --- | --- |
| `services/index.js` | Main path | builds the renderer service bundle plus re-exports registry/service factories |
| `services/module-registry.js` | Cross-cutting | tiny DI-style registry shared by the shell and services |
| `services/protocolService.js` | Cross-cutting | protocol import/share hooks, external saved-protocol merges, and paper-to-protocol drafts |
| `services/notebookService.js` | Cross-cutting | notebook-driven rerender fan-out |
| `services/projectService.js` | Cross-cutting | project-driven rerender fan-out |
| `services/inventoryService.js` | Cross-cutting | sample-registry refresh and sample-search handoff |
| `services/analysisService.js` | Cross-cutting | assay updates back into project summaries |
| `modules/sequence-viewer/service.js` | Cross-cutting | toolbox-to-sequence-viewer handoff, owned by the destination feature |
| `services/undoService.js` | Main path | global undo/redo; wraps `persist()` |
| `services/unsavedChangesService.js` | Main path | the quit-time unsaved-changes dialog |
| `services/notebook-page-log.js` | Cross-cutting | append-only `page.log` per notebook page |
| `services/notebook-record-compat.js` | Cross-cutting | reads persisted Sequence Viewer cloning records inside notebook entries |

## Feature modules (manifest-registered)

These are the workspaces wired in `module-manifests/index.js`, grouped by manifest family (boot order roughly follows this order). Each manifest names an `init` entry and a `viewKey` from `modules/views.js`.

| Manifest key | View | Entry file | Implementation |
| --- | --- | --- | --- |
| `biologyNotebook` | `BIOLOGY_NOTEBOOK` | `modules/biology-notebook/index.js` | projects, biology / wet-lab notebook records, and the `agent/` draft adapter (entry export is still named `initLabNotebook`) |
| `protocol` | `PROTOCOL_MANAGEMENT` | `modules/protocol/index.js` | protocol CRUD, viewing, sharing, import, and its `agent/` generated-record adapter |
| `agentChat` | `AGENT` | `modules/agent-chat/index.js` | chat UI, sessions, context |
| `agentChatRail` | (rail, no view) | `modules/agent-chat/index.js` + `agent-chat/scoped-state.js` | scoped agent chat embedded as a side rail in Notebook, Plate (Assay), and Papers |
| `workflowManagement` | `WORKFLOW_MANAGEMENT` | `modules/workflow/index.js` | workflow model, graph editor, list rendering, actions |
| `papers` | `PAPERS` | `modules/papers/index.js` | library rail, PDF viewer, comments, LLM helpers |
| `labCommonInventory` | `LAB_COMMON_INVENTORY` | `modules/lab-common-inventory/index.js` | shared chemical inventory ("Chemicals") |
| `personalInventory` | `PERSONAL_INVENTORY` | `modules/personal-inventory/index.js` | container-centric storage workspace |
| `sampleRegistry` | `SAMPLE_REGISTRY` | `modules/sample-registry/index.js` | sample-centric registry workspace |
| `assay` | `ASSAY` | `modules/assay/index.js` | plate layout, result grid, charts, analysis math |
| `sequenceViewer` | `SEQUENCE_VIEWER` | `modules/sequence-viewer/index.js` | import, library, detail, alignment, annotation, cloning, Protein Builder, Vector Builder |
| `toolBox` | `TOOL_BOX` | `modules/tool-box/index.js` | eight calculators plus the lazy-loaded colony counter |
| `settings` | `SETTING` | `modules/settings/index.js` | appearance, startup, storage, vocabularies, Codex, tool access, skills, and plugins |
| `homeDashboard` | `HOME` | `modules/home-dashboard/index.js` | dashboard widgets, timers, and the **Prepare notebook page** agent dialog |

See [heavyweight-subsystems.md](../features/heavyweight-subsystems.md) for the internal structure of the largest folder modules (`agent-chat/`, `assay/`, `papers/`, `sequence-viewer/`, `workflow/`, `tool-box/`).

## Public API and composition files

These files expose a deliberate secondary API or compose features that do not use a conventional folder entry.

| File | Status | Notes |
| --- | --- | --- |
| `modules/agent-chat/public-api.js` | Support | `initAgentChat`, scoped chat state, and the response/state-snapshot surface used outside Agent Chat |
| `modules/sequence-viewer/public-api.js` | Support | explicit parsing, rendering, ORF, restriction, alignment, and embedding API |
| `modules/assay/public-api.js`, `modules/workflow/public-api.js`, `modules/sample-registry/public-api.js` | Support | narrow APIs other features import instead of reaching into the folder |

## Cross-cutting libraries and adapters

| File | Status | Notes |
| --- | --- | --- |
| `modules/views.js` | Cross-cutting | generated `VIEWS` and `TITLES` constants sourced from `ui/config/app-registry.json` |
| `modules/app-state/index.js` | Cross-cutting | small public facade over the normalization modules in `modules/app-state/` |
| `lib/app-utils.js` | Cross-cutting | shared renderer helpers such as `createId`, `safeText`, and `cssEscape` |
| `modules/app-state/storage-path-normalizer.js` | Cross-cutting | normalizes persisted record paths during state hydration |
| `lib/file-drop.js` | Cross-cutting | reusable drag-and-drop file-target binding (used by papers, sequence import, etc.) |
| `lib/unsaved-draft.js` | Cross-cutting | stable form snapshots for unsaved-change detection |
| `lib/notebook-result-tables.js` | Cross-cutting | notebook result-table normalization/cloning helpers |
| `lib/notebook-tool-calculations.js` | Cross-cutting | notebook calculation normalization and rendering model |
| `lib/inventory-settings.js` | Cross-cutting | inventory location and sample-type settings normalization |
| `services/direct-llm.js` | Cross-cutting | direct (non-agent) LLM request helper and provider settings builder |
| `modules/sample-registry/chemical-structure-clipboard.js` | Feature-owned | reads chemical-structure candidates; Personal Inventory uses it through `sample-registry/public-api.js` |
| `modules/biology-notebook/linked-previews.js` | Feature-owned | builds linked assay/gel/record preview models for notebook entries |
| `services/notebook-note-tools.js` | Cross-cutting | LLM note-clarification helpers |
| `lib/notify.js` | Cross-cutting | app-wide transient notices |
| `lib/formula.js`, `lib/notebook-table-formulas.js` + `notebook-table-formulas/` | Cross-cutting | the spreadsheet formula language and notebook table addressing |
| `lib/spreadsheet-fill-handle.js`, `lib/spreadsheet-reference-picker.js`, `lib/table-units.js` | Cross-cutting | spreadsheet fill-drag, click-to-insert references, and column units (Notebook and Assay) |
| `lib/gel-records.js` | Cross-cutting | the one reader for Gel plugin records (and legacy `gelAnalyses`) |
| `lib/plugin-storage.js`, `lib/bundled-plugins.js` | Cross-cutting | per-plugin storage size guard and the bundled plugin list |
| `lib/search-field-lens.js`, `lib/folder-tree.js` | Cross-cutting | shared search-field wrapper and folder-tree helpers for rails |
| `lib/protocol-snapshot.js`, `lib/sample-records.js`, `lib/inventory-containers.js`, `lib/plate-wells.js`, `lib/cell-passage.js`, `lib/compound-structure.js` | Cross-cutting | record models shared by several features |
| `modules/agent-chat/experiment-llm-mapper.js` | Feature-owned | compresses notebook, assay, and gel data into LLM-friendly JSON |

## App configuration (generated)

| File | Status | Notes |
| --- | --- | --- |
| `modules/app-registry.generated.js` | Main path | generated shell config for dock, aliases, and view metadata |
| `modules/codex-model-catalog.generated.js` | Support | generated Codex model catalog for the renderer |

## Bundled datasets and specialty utilities

| File | Status | Notes |
| --- | --- | --- |
| `lib/chemistry/buffer-compounds.js` | Support | buffer-compound constants shared by Toolbox and notebook calculations |
| `modules/pdf-export/` | Support | shared PDF export helpers for protocol/notebook-like views |
| `modules/print/` | Support | shared print-window helper |
| `modules/selection-insights/` | Cross-cutting | selection-driven insight panels reused by several views |

## Removed legacy workspaces

The unwired Collaboration Management and Lab Management views were removed instead of being preserved as production-like source. Protocol sharing remains under `modules/protocol/`, while member/message data still supports active Protocol, Workflow, and inventory flows.

The standalone Instruments workspace and a separate synthesis "lab notebook" also no longer ship. The wet-lab notebook lives in `modules/biology-notebook/` (whose entry export is still named `initLabNotebook`).

## Good entry points

If you want to read the code after this doc set, start here:

1. `src/renderer/core/start-hikari-core.js`
2. `src/renderer/core/module-runtime.js`
3. `src/renderer/module-manifests/index.js`
4. `src/renderer/modules/app-state/index.js`
5. `src/renderer/services/index.js`
6. one focused feature package such as `src/renderer/modules/biology-notebook/project/project-controller.js`
7. one large subsystem entry such as `src/renderer/modules/sequence-viewer/index.js`

That order makes the rest of the package much easier to place.
