# Module Map

This is a quick lookup map for `src/renderer`.

## Legend

- `Main path`: directly involved in renderer boot or shell behavior
- `Feature entry`: main entry file for a user-facing workspace
- `Cross-cutting`: shared runtime helper used by many features
- `Support`: wrapper, dataset, export helper, or secondary utility

## Root files

| File | Status | Notes |
| --- | --- | --- |
| `renderer.js` | Main path | browser-side composition root, boot flow, navigation, search, hydration, persistence |
| `services/index.js` | Main path | builds the renderer service bundle plus re-exports registry/service factories |
| `services/module-registry.js` | Cross-cutting | tiny DI-style registry shared by the shell and services |
| `services/protocolService.js` | Cross-cutting | protocol import/share hooks plus paper-to-protocol drafts |
| `services/notebookService.js` | Cross-cutting | notebook-driven rerender fan-out |
| `services/projectService.js` | Cross-cutting | project-driven rerender fan-out |
| `services/inventoryService.js` | Cross-cutting | sample-registry refresh and sample-search handoff |
| `services/analysisService.js` | Cross-cutting | assay/gel updates back into project summaries |
| `services/sequenceService.js` | Cross-cutting | toolbox-to-sequence-viewer handoff |

## Root-level module files

| File | Status | Notes |
| --- | --- | --- |
| `modules/shared.js` | Cross-cutting | canonical renderer state contract and helper surface |
| `modules/app-registry.generated.js` | Main path | generated shell config for dock, aliases, and view metadata |
| `modules/object-graph.js` | Cross-cutting | derived graph builder over protocols, notebooks, inventory, workflows, assays, gels, and papers |
| `modules/pdf-export.js` | Support | shared export helpers for protocol/notebook-like views |
| `modules/lab-management.js` | Feature entry | members directory |
| `modules/instrument-management.js` | Feature entry | instruments plus reservation calendar |
| `modules/protocol-management.js` | Feature entry | protocol CRUD, viewing, sharing, and import |
| `modules/lab-notebook.js` | Feature entry | synthesis notebook |
| `modules/biology-notebook.js` | Feature entry | biology notebook |
| `modules/lab-common-inventory.js` | Feature entry | common chemical inventory |
| `modules/personal-inventory.js` | Feature entry | container-centric storage workspace |
| `modules/sample-registry.js` | Feature entry | sample-centric registry workspace |
| `modules/project-management.js` | Feature entry | projects plus linked notebook rollups |
| `modules/collaboration-management.js` | Feature entry | messaging and protocol sharing/import |
| `modules/home-dashboard.js` | Feature entry | dashboard summaries and timer |
| `modules/settings.js` | Feature entry | renderer-config UI and storage/LLM settings |

## Folder-based subsystems

| Folder | Status | Notes |
| --- | --- | --- |
| `modules/agent-chat/` | Feature entry | chat UI, session management, context snapshots, response normalization |
| `modules/assay/` | Feature entry | plate layout, result grid, charts, and analysis math |
| `modules/gel/` | Feature entry | image pipeline, lane/band analysis, and export |
| `modules/papers/` | Feature entry | library rail, PDF viewer, comments, and LLM-assisted actions |
| `modules/sequence-viewer/` | Feature entry | sequence import, library, detail view, alignment, annotation, analysis |
| `modules/tool-box/` | Feature entry | calculator and analysis mini-tools inside one shared workspace |
| `modules/workflow/` | Feature entry | workflow model, graph editor, renderer, and actions |

## Wrapper and helper adapters

| File | Status | Notes |
| --- | --- | --- |
| `modules/agent-chat.js` | Support | wrapper into `agent-chat/index.js`; preserves test and downstream contract anchors |
| `modules/agent-chat-response.js` | Support | stable re-export surface for agent response helpers |
| `modules/assay.js` | Support | wrapper into `assay/index.js` |
| `modules/assay-analysis.js` | Support | pure assay-analysis entry point |
| `modules/gel-analysis.js` | Support | wrapper plus pure gel-analysis helper exports |
| `modules/papers-management.js` | Support | wrapper into `papers/index.js` |
| `modules/papers-pdf-viewer.js` | Support | stable PDF-viewer helper exports |
| `modules/sequence-viewer.js` | Support | wrapper plus pure sequence helper exports and bridge injection |
| `modules/workflow-management.js` | Support | wrapper into `workflow/index.js` |
| `modules/tool-box.js` | Support | toolbox composition root over many mini-tools |

## Bundled datasets and specialty utilities

| File | Status | Notes |
| --- | --- | --- |
| `modules/experiment-llm-mapper.js` | Support | compresses notebook, assay, and gel data into LLM-friendly JSON |
| `modules/plannotate-js.js` | Support | local annotation engine backed by bundled feature references |
| `modules/plannotate-reference-db.js` | Support | bundled reference features used by local plannotate logic |
| `modules/commercial-restriction-enzymes.js` | Support | generated enzyme catalog used by sequence analysis |
| `modules/buffer-compounds.js` | Support | buffer-compound constants for toolbox calculations |
| `modules/papers-pdfjs-compat.js` | Support | compatibility layer for the PDF viewer runtime |
| `modules/papers-pdfjs-worker.js` | Support | tiny worker stub for PDF.js wiring |

## Good entry points

If you want to read the code after this doc set, start here:

1. `src/renderer/renderer.js`
2. `src/renderer/modules/shared.js`
3. `src/renderer/services/index.js`
4. one simple controller such as `src/renderer/modules/project-management.js`
5. one large subsystem entry such as `src/renderer/modules/sequence-viewer/index.js`

That order makes the rest of the package much easier to place.
