# Module Families

Not every renderer module is built the same way. A useful first cut is to separate the root-level single-file controllers from the larger folder-based subsystems.

## The common single-file controller pattern

Many root-level files under `src/renderer/modules/` follow the same shape:

1. capture DOM nodes once
2. bind event listeners once
3. read and mutate shared `state`
4. call the shared `persist()` callback after mutations
5. expose a compact API such as `render()`, `renderList()`, or `renderProjectOptions()`

These files are usually easier to refactor than the folder-based subsystems because orchestration, view rendering, and state mutation all live together.

## Root-level feature controllers

| File | Main role | Notes |
| --- | --- | --- |
| `lab-management.js` | members directory CRUD | one of the simplest modules; good for learning the house style |
| `instrument-management.js` | instrument list plus reservation calendar | single file, but richer than most because it owns month/week calendar behavior |
| `protocol-management.js` | protocol editor, viewer, sharing, and JSON import | large single-file controller with multiple panels |
| `lab-notebook.js` | synthesis notebook pages | includes chemistry-specific draft state, file import, and Ketcher-oriented flow |
| `biology-notebook.js` | biology notebook pages | protocol-backed notebook flow with planned/executed page handling |
| `lab-common-inventory.js` | shared chemical inventory | also owns inbox-driven import and location-code bookkeeping |
| `personal-inventory.js` | storage containers and well-level sample placement | container-centric UI; shares workspace with `sample-registry.js` |
| `sample-registry.js` | sample records and search | sample-centric UI; links to personal inventory containers and chemicals |
| `project-management.js` | project CRUD and linked notebook rollups | also summarizes linked assays and gels per project |
| `collaboration-management.js` | internal messaging and protocol sharing/import | good example of a feature that mostly manipulates existing protocols rather than owning a new domain |
| `home-dashboard.js` | dashboard summaries, workflow progress, and timer | read-mostly view over other state branches |
| `settings.js` | appearance, storage, startup, LLM, Telegram, and `.ena` settings | main entry point for renderer-to-main storage configuration |

## A few important one-file wrinkles

- `lab-notebook.js` and `biology-notebook.js` look similar, but they are not wrappers around the same implementation. They have diverged enough that each deserves separate reading.
- `personal-inventory.js` and `sample-registry.js` intentionally share one workspace. The shell treats `sample-registry-view` as a composite view.
- `protocol-management.js` and `settings.js` are still single files, but they are big enough to behave like mini-subsystems.

## Root-level support and adapter files

Some top-level module files are not primary views. They are wrappers, adapters, or data helpers.

| File | Purpose |
| --- | --- |
| `shared.js` | renderer-wide constants, default state, normalization, persistence helpers |
| `object-graph.js` | derived relationship graph builder and query helpers |
| `pdf-export.js` | shared PDF export helpers used by protocols and notebook-like views |
| `agent-chat-response.js` | stable re-export layer for agent response formatting helpers |
| `assay-analysis.js` | stable re-export layer for assay analysis functions |
| `papers-pdf-viewer.js` | stable re-export layer for the papers PDF viewer helpers |
| `experiment-llm-mapper.js` | compact LLM-facing mapper for notebook, assay, and gel data |
| `plannotate-js.js` | local sequence-annotation engine based on bundled reference features |
| `buffer-compounds.js` | reference list for buffer calculations |
| `commercial-restriction-enzymes.js` | generated restriction-enzyme catalog for sequence analysis |
| `plannotate-reference-db.js` | bundled reference-feature database used by local plannotate logic |
| `app-registry.generated.js` | generated shell configuration for labels, aliases, and dock placement |

## Reading advice

If you are new to the renderer codebase, read one simple controller first before jumping into a large subsystem.

Good starter files:

1. `lab-management.js`
2. `project-management.js`
3. `home-dashboard.js`

Those three show the usual renderer style without the complexity of image processing, PDF rendering, or sequence analysis.
