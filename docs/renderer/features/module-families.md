# Module Families

This doc explains how renderer feature modules are grouped and what shape they share. For a file-by-file lookup see [module-map.md](../reference/module-map.md); for the internals of the largest folders see [heavyweight-subsystems.md](heavyweight-subsystems.md).

## Two structural patterns

The renderer has largely finished migrating from single-file controllers to **folder modules**. Today almost every workspace lives in `modules/<feature>/` with an `index.js` entry, and only a handful of thin top-level files remain.

- **Folder module** (`modules/<feature>/index.js`): the entry is usually an orchestrator that captures DOM nodes, builds sub-controllers, wires events, and exposes a compact API (`render()`, `renderList()`, ...). `gel/`, `assay/`, `papers/`, `sequence-viewer/`, `workflow/`, and the inventory/notebook folders all follow this.
- **Thin top-level orchestrator** that delegates to a folder: e.g. `home-dashboard.js` wires the widgets under `home-dashboard/`; `tool-box.js` composes the mini-tools under `tool-box/`. Conventional folder features are imported directly from their `index.js`; only deliberate secondary APIs, such as `sequence-viewer/public-api.js`, get another entry point.

## The shared module contract

Whatever the shape, feature modules follow the same house style:

1. capture DOM nodes once
2. bind event listeners once
3. read and mutate the shared `state` object directly
4. call the shared `persist()` callback after mutations (the renderer core owns storage — see [boot-and-shell.md](../architecture/boot-and-shell.md))
5. expose a compact API such as `render()` / `renderList()`

Modules do **not** own their own persistence; `persist()` rebuilds the object graph, writes local storage, and optionally auto-saves the `.ena` file.

## Manifest families

`app-registry.json` is the source of truth for user-facing views and order. `module-manifests/index.js` is the source of truth for how feature controllers initialize and render; its declarations are organized into six families and merged into `rendererModuleManifests`:

| Family | Manifests | Theme |
| --- | --- | --- |
| `foundation` | `biologyNotebook`, `protocol`, `projectManagement` | core record-keeping that other features link into |
| `collaboration` | `agentChat`, `agentChatRail`, `workflowManagement`, `papers` | assistant, workflows, and shared research surfaces |
| `inventory` | `labCommonInventory`, `personalInventory`, `sampleRegistry` | chemicals, storage containers, and samples |
| `analysis` | `assay`, `gel` | plate/gel data capture and analysis |
| `sequence` | `sequenceViewer` | sequence import, library, inspection, and analysis |
| `utility` | `toolBox`, `settings`, `homeDashboard` | calculators, configuration, and the dashboard |

Each manifest declares an `init` entry, a `viewKey` (from `modules/views.js`), and a `bootOrder`. `module-runtime.js` initializes modules in `bootOrder`, which roughly runs `protocol` (10) → `projectManagement` (20) → `workflowManagement` (30) → `labCommonInventory` (40) → `biologyNotebook` (50) → `sampleRegistry` (60) → `assay` (70) → `gel` (80) → `settings` (90) → `homeDashboard` (100) → `papers` (110) → `agentChat` (120). Boot order is independent of the family grouping above.

`agentChatRail` is special: it has no view of its own and mounts a paper-scoped agent chat as a side rail inside the Papers workspace.

## A few wrinkles worth knowing

- `personalInventory` and `sampleRegistry` intentionally share one workspace. The shell treats `sample-registry-view` as a composite view and renders both on open (see [boot-and-shell.md](../architecture/boot-and-shell.md)).
- The wet-lab notebook entry export is still named `initLabNotebook` even though it now lives in `modules/biology-notebook/`. There is no separate synthesis notebook anymore.
- `Projects` is registered but hidden from primary navigation; it is reached through links from other records.
- `modules/collaboration-management/` and `modules/lab-management.js` exist in the tree but are not registered in any manifest and have no static importers — treat them as legacy/unwired.

## Root-level support and adapter files

| File / folder | Purpose |
| --- | --- |
| `views.js`, `app-state.js`, `utils.js` | renderer-wide constants, default state, normalization, persistence helpers, and small shared utilities |
| `object-graph.js` | derived relationship graph builder and query helpers |
| `storage-path-normalizer.js` | normalizes storage paths across state on load |
| `file-drop.js` | reusable drag-and-drop file-target binding |
| `direct-llm.js` | direct (non-agent) LLM request helper |
| `notebook-result-table.js`, `notebook-linked-previews.js`, `notebook-note-tools.js` | shared notebook table / preview / note helpers |
| `experiment-llm-mapper.js` | compact LLM-facing mapper for notebook, assay, and gel data |
| `pdf-export/`, `print/`, `selection-insights/` | shared export, print, and selection-insight helpers |
| `buffer-compounds.js`, `common-promoters.js` | reference datasets for toolbox and sequence features |
| `app-registry.generated.js`, `llm-provider-config.generated.js` | generated shell configuration and LLM provider catalog |

The generated commercial restriction-enzyme catalog lives in `src/shared/data/commercial-restriction-enzymes.js`; process-neutral restriction detection lives in `src/shared/sequence/restriction-features.js`.

## Reading advice

If you are new to the renderer, read one small module before a large subsystem.

Good starter files:

1. `modules/home-dashboard.js` — a ~180-line orchestrator that hands typed element bundles to independent widgets
2. `modules/workflow/index.js` — one of the cleanest folder separations (model / renderer / graph-controller / actions / state)
3. `modules/project-management/index.js` — a readable folder module that links into notebooks, assays, and gels

Those show the usual renderer style without the complexity of image processing, PDF rendering, or sequence analysis.
