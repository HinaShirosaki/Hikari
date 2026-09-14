# Module Families

This doc explains how renderer feature modules are grouped and what shape they share. For a file-by-file lookup see [module-map.md](../reference/module-map.md); for the internals of the largest folders see [heavyweight-subsystems.md](heavyweight-subsystems.md).

## Two structural patterns

The renderer has largely finished migrating from single-file controllers to **folder modules**. Today almost every workspace lives in `modules/<feature>/` with an `index.js` entry, and only a handful of thin top-level files remain.

- **Folder module** (`modules/<feature>/index.js`): the entry is usually an orchestrator that captures DOM nodes, builds sub-controllers, wires events, and exposes a compact API (`render()`, `renderList()`, ...). `assay/`, `papers/`, `sequence-viewer/`, `workflow/`, and the inventory/notebook folders all follow this.
- **Thin top-level orchestrator** that delegates to a folder: e.g. `home-dashboard.js` wires the widgets under `home-dashboard/`; `tool-box.js` composes the mini-tools under `tool-box/`. Conventional folder features are imported directly from their `index.js`; only deliberate secondary APIs, such as `sequence-viewer/public-api.js`, get another entry point.

## The shared module contract

Whatever the shape, feature modules follow the same house style:

1. capture DOM nodes once
2. bind event listeners once
3. read and mutate the shared `state` object directly
4. call the shared `persist()` callback after mutations (the renderer core owns undo checkpoints and storage — see [boot-and-shell.md](../architecture/boot-and-shell.md))
5. expose a compact API such as `render()` / `renderList()`

Modules do **not** own their own persistence; `persist()` records undo state, normalizes storage paths, writes local storage, and optionally auto-saves the `.json` snapshot.

## Manifest families

`app-registry.json` is the source of truth for user-facing views and order. `module-manifests/index.js` is the source of truth for how feature controllers initialize and render; its declarations are organized into six families and merged into `rendererModuleManifests`:

| Family | Manifests | Theme |
| --- | --- | --- |
| `foundation` | `biologyNotebook`, `protocol` | core record-keeping that other features link into |
| `collaboration` | `agentChat`, `agentChatRail`, `workflowManagement`, `papers` | assistant, workflows, and shared research surfaces |
| `inventory` | `labCommonInventory`, `personalInventory`, `sampleRegistry` | chemicals, storage containers, and samples |
| `analysis` | `assay` | plate data capture and analysis |
| `sequence` | `sequenceViewer` | sequence import, library, inspection, and analysis |
| `utility` | `toolBox`, `settings`, `homeDashboard` | calculators, configuration, and the dashboard |

Each manifest declares an `init` entry, a `viewKey` (from `modules/views.js`), and optionally a `bootOrder`. `module-runtime.js` runs boot renders in order: `protocol` (10) → `workflowManagement` (30) → `labCommonInventory` (40) → `biologyNotebook` (50) → `sampleRegistry` (60) → `assay` (70) → `settings` (90) → `homeDashboard` (100) → `papers` (110) → `agentChat` (120). Modules without a boot order still initialize and register normally. Boot order is independent of the family grouping above.

`agentChatRail` is special: it has no view of its own and mounts a scoped agent chat as a side rail in Papers, Biology Notebook, and Assay.

## A few wrinkles worth knowing

- `personalInventory` and `sampleRegistry` intentionally share one workspace. The shell treats `sample-registry-view` as a composite view and renders both on open (see [boot-and-shell.md](../architecture/boot-and-shell.md)).
- The wet-lab notebook entry export is still named `initLabNotebook` even though it now lives in `modules/biology-notebook/`. There is no separate synthesis notebook anymore.
- Project creation, selection, and dashboards are part of Biology Notebook (`modules/biology-notebook/project/`); there is no standalone Projects view or manifest.
- Legacy Collaboration Management and Lab Management source was removed because neither workspace was registered in a manifest or navigation surface.

## Shared libraries and adapter services

| File / folder | Purpose |
| --- | --- |
| `views.js`, `app-state.js`, `utils.js` | renderer-wide constants, default state, normalization, persistence helpers, and small shared utilities |
| `modules/app-state/` | state defaults, normalization, appearance, persistence, and storage-path hydration |
| `lib/file-drop.js`, `lib/unsaved-draft.js` | reusable DOM-independent interaction/state helpers |
| `lib/notebook-result-tables.js` | pure notebook result-table model |
| `services/direct-llm.js` | direct (non-agent) LLM request adapter |
| `services/notebook-linked-previews.js`, `services/notebook-note-tools.js` | cross-feature notebook preview and note integrations |
| `services/experiment-llm-mapper.js` | compact LLM-facing mapper for notebook, assay, and gel data |
| `pdf-export/`, `print/`, `selection-insights/` | shared export, print, and selection-insight helpers |
| `lib/chemistry/buffer-compounds.js` | reference dataset shared by Toolbox and notebook calculations |
| `app-registry.generated.js`, `codex-model-catalog.generated.js` | generated shell configuration and Codex model catalog |

The generated commercial restriction-enzyme catalog and process-neutral restriction detection live inside `src/renderer/modules/sequence-viewer/`.

## Reading advice

If you are new to the renderer, read one small module before a large subsystem.

Good starter files:

1. `modules/home-dashboard.js` — a ~180-line orchestrator that hands typed element bundles to independent widgets
2. `modules/workflow/index.js` — one of the cleanest folder separations (model / renderer / graph-controller / actions / state)
3. `modules/biology-notebook/project/project-controller.js` — a focused state mutation and dialog controller inside its owning feature

Those show the usual renderer style without the complexity of image processing, PDF rendering, or sequence analysis.
