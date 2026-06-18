# Module Map

This is a quick lookup map for `src/renderer`.

Most user-facing features are **folder modules** (`modules/<feature>/index.js`) registered through `module-manifests/`. Top-level `.js` files are reserved for cross-cutting helpers, generated configuration, or composition roots that do not have a folder entry.

## Legend

- `Main path`: directly involved in renderer boot or shell behavior
- `Feature entry`: main entry file for a user-facing workspace (manifest-registered)
- `Cross-cutting`: shared runtime helper used by many features
- `Support`: wrapper, dataset, export helper, or secondary utility

## Renderer boot and shell

| File | Status | Notes |
| --- | --- | --- |
| `renderer.js` | Main path | browser-side script entry that calls the app wrapper |
| `app/start-renderer-app.js` | Main path | compatibility wrapper into the renderer core |
| `core/start-hikari-core.js` | Main path | renderer core: state, services, modules, navigation, search, hydration, persistence |
| `module-runtime.js` | Main path | composes manifest-declared modules and builds route/boot render dispatch from manifest metadata |
| `module-manifests/` | Main path | per-module init/render declarations grouped by boot order and feature family |
| `app/topbar-open-handlers.js` | Main path | topbar search result open routing for domain records |

## Shared services

| File | Status | Notes |
| --- | --- | --- |
| `services/index.js` | Main path | builds the renderer service bundle plus re-exports registry/service factories |
| `services/module-registry.js` | Cross-cutting | tiny DI-style registry shared by the shell and services |
| `services/protocolService.js` | Cross-cutting | protocol import/share hooks, external saved-protocol merges, and paper-to-protocol drafts |
| `services/notebookService.js` | Cross-cutting | notebook-driven rerender fan-out |
| `services/projectService.js` | Cross-cutting | project-driven rerender fan-out |
| `services/inventoryService.js` | Cross-cutting | sample-registry refresh and sample-search handoff |
| `services/analysisService.js` | Cross-cutting | assay/gel updates back into project summaries |
| `services/sequenceService.js` | Cross-cutting | toolbox-to-sequence-viewer handoff |

## Feature modules (manifest-registered)

These are the workspaces wired in `module-manifests/index.js`, grouped by manifest family (boot order roughly follows this order). Each manifest names an `init` entry and a `viewKey` from `modules/views.js`.

| Manifest key | View | Entry file | Implementation |
| --- | --- | --- | --- |
| `biologyNotebook` | `BIOLOGY_NOTEBOOK` | `modules/biology-notebook/index.js` | biology / wet-lab notebook (entry export is still named `initLabNotebook`) |
| `protocol` | `PROTOCOL_MANAGEMENT` | `modules/protocol/index.js` | protocol CRUD, viewing, sharing, import |
| `projectManagement` | `PROJECT_MANAGEMENT` | `modules/project-management/index.js` | projects plus linked notebook/paper rollups |
| `agentChat` | `AGENT` | `modules/agent-chat/index.js` | chat UI, sessions, context |
| `agentChatRail` | (rail, no view) | `modules/agent-chat/index.js` + `agent-chat/scoped-state.js` | paper-scoped agent chat embedded as a side rail |
| `workflowManagement` | `WORKFLOW_MANAGEMENT` | `modules/workflow/index.js` | workflow model, graph editor, list rendering, actions |
| `papers` | `PAPERS` | `modules/papers/index.js` | library rail, PDF viewer, comments, LLM helpers |
| `labCommonInventory` | `LAB_COMMON_INVENTORY` | `modules/lab-common-inventory/index.js` | shared chemical inventory ("Chemicals") |
| `personalInventory` | `PERSONAL_INVENTORY` | `modules/personal-inventory/index.js` | container-centric storage workspace |
| `sampleRegistry` | `SAMPLE_REGISTRY` | `modules/sample-registry/index.js` | sample-centric registry workspace |
| `assay` | `ASSAY` | `modules/assay/index.js` | plate layout, result grid, charts, analysis math |
| `gel` | `GEL` | `modules/gel/index.js` | image pipeline, manual segmentation, analysis, export |
| `sequenceViewer` | `SEQUENCE_VIEWER` | `modules/sequence-viewer/index.js` | import, library, detail, alignment, annotation, analysis |
| `toolBox` | `TOOL_BOX` | `modules/tool-box.js` | `modules/tool-box/` — calculator and analysis mini-tools |
| `settings` | `SETTING` | `modules/settings/index.js` | renderer-config UI and storage/LLM settings |
| `homeDashboard` | `HOME` | `modules/home-dashboard.js` (wrapper) | `modules/home-dashboard/` — dashboard widgets and timer |

See [heavyweight-subsystems.md](../features/heavyweight-subsystems.md) for the internal structure of the largest folder modules (`agent-chat/`, `assay/`, `gel/`, `papers/`, `sequence-viewer/`, `workflow/`, `tool-box/`).

## Public API and composition files

These files expose a deliberate secondary API or compose features that do not use a conventional folder entry.

| File | Status | Notes |
| --- | --- | --- |
| `modules/agent-chat-response.js` | Support | stable re-export surface for agent response helpers |
| `modules/gel/public-api.js` | Support | explicit pure gel-analysis API used by contracts and non-view consumers |
| `modules/sequence-viewer/public-api.js` | Support | explicit parsing, rendering, ORF, restriction, alignment, and embedding API |
| `modules/tool-box.js` | Support | toolbox composition root over many mini-tools (the `tool-box/` folder has no `index.js`) |
| `modules/home-dashboard.js` | Support | orchestrator that wires the `home-dashboard/` widgets (the folder has no `index.js`) |

## Cross-cutting root-level files

| File | Status | Notes |
| --- | --- | --- |
| `modules/views.js` | Cross-cutting | generated `VIEWS` and `TITLES` constants sourced from `ui/config/app-registry.json` |
| `modules/app-state.js` | Cross-cutting | small public facade over the normalization modules in `modules/app-state/` |
| `modules/utils.js` | Cross-cutting | shared renderer helpers such as `createId`, `safeText`, and `cssEscape` |
| `modules/object-graph.js` | Cross-cutting | derived graph builder over protocols, notebooks, inventory, workflows, assays, gels, papers |
| `modules/storage-path-normalizer.js` | Cross-cutting | normalizes storage paths across state on load |
| `modules/file-drop.js` | Cross-cutting | reusable drag-and-drop file-target binding (used by gel, papers, sequence import, etc.) |
| `modules/direct-llm.js` | Cross-cutting | direct (non-agent) LLM request helper and provider settings builder |
| `modules/chemical-structure-clipboard.js` | Cross-cutting | reads chemical-structure candidates from clipboard paste |
| `modules/notebook-result-table.js` | Cross-cutting | notebook result-table normalization/cloning helpers |
| `modules/notebook-linked-previews.js` | Cross-cutting | linked assay/gel/record preview rendering for notebook entries |
| `modules/notebook-note-tools.js` | Cross-cutting | transient notices and LLM note-clarification helpers |
| `modules/experiment-llm-mapper.js` | Support | compresses notebook, assay, and gel data into LLM-friendly JSON |

## App configuration (generated)

| File | Status | Notes |
| --- | --- | --- |
| `modules/app-registry.generated.js` | Main path | generated shell config for dock, aliases, and view metadata |
| `modules/llm-provider-config.generated.js` | Support | generated LLM provider catalog for the renderer |

## Bundled datasets and specialty utilities

| File | Status | Notes |
| --- | --- | --- |
| `modules/buffer-compounds.js` | Support | buffer-compound constants for toolbox calculations |
| `modules/common-promoters.js` | Support | common-promoter sequence library dataset |
| `modules/pdf-export/` | Support | shared PDF export helpers for protocol/notebook-like views |
| `modules/print/` | Support | shared print-window helper |
| `modules/selection-insights/` | Cross-cutting | selection-driven insight panels reused by several views |

## Present but not statically wired

These exist in the tree but are not registered in `module-manifests/` and have no static importers. Treat them as legacy or in-progress, and confirm before relying on them.

| Path | Notes |
| --- | --- |
| `modules/collaboration-management/` | messaging / protocol-sharing workspace; not in `VIEWS` or any manifest |
| `modules/lab-management.js` | members directory (`initLabManagement`); not currently registered |

> Removed since earlier docs: the standalone `Instruments` workspace and a separate synthesis "lab notebook" no longer ship. The wet-lab notebook lives in `modules/biology-notebook/` (whose entry export is still named `initLabNotebook`).

## Good entry points

If you want to read the code after this doc set, start here:

1. `src/renderer/core/start-hikari-core.js`
2. `src/renderer/module-runtime.js`
3. `src/renderer/module-manifests/index.js`
4. `src/renderer/modules/app-state.js`
5. `src/renderer/services/index.js`
6. one simple folder module such as `src/renderer/modules/project-management/index.js`
7. one large subsystem entry such as `src/renderer/modules/sequence-viewer/index.js`

That order makes the rest of the package much easier to place.
