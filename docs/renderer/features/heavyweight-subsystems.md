# Heavyweight Subsystems

These are the renderer areas where the code is split into dedicated folders because a single-file controller would be too hard to reason about.

## At a glance

| Subsystem | Entry point | Approx. size | Mental model |
| --- | --- | --- | --- |
| `agent-chat/` | `modules/agent-chat/index.js` | about 6.4k lines | chat UI plus session/context orchestration on top of main-process agent IPC |
| `assay/` | `modules/assay/index.js` | about 9.0k lines | plate-definition editor, result grid, and analysis views (incl. `analysis/`) |
| `biology-notebook/` | `modules/biology-notebook/index.js` | about 7.0k lines | notebook entry lifecycle with focused entry, protocol, project, results, sample, storage, and tools packages |
| `papers/` | `modules/papers/index.js` | about 7.5k lines | library rail, PDF viewer, comments, paper actions, and LLM helpers |
| `sequence-viewer/` | `modules/sequence-viewer/index.js` | about 18.7k lines | file parsing, library storage, detailed sequence inspection, alignment, annotation, and analysis |
| `workflow/` | `modules/workflow/index.js` | about 3.9k lines | workflow data model, graph editor, list rendering, and actions |
| `tool-box/` | `modules/tool-box.js` | about 7.2k lines | many small calculator/analysis tools sharing one workspace shell |

> Sizes are approximate and drift as subsystems grow. Regenerate a current snapshot with `find src/renderer/modules/<name> -name '*.js' | xargs wc -l` when in doubt.

## `agent-chat/`

Start in `agent-chat/index.js`.

That file owns the renderer-side chat experience:

- project-scoped context selection
- history rendering
- session selection and creation
- review-card presentation and dispatch to feature-owned agent adapters

Subfiles are split cleanly:

- `session-manager.js`: session lifecycle and list rendering
- `rendering.js`: message/history DOM rendering
- `response.js`: normalization and summary helpers for returned agent payloads
- `state-snapshot.js`: compact experiment/context snapshot generation
- `review-overlay.js`: generic approval/rejection UI dispatched through feature adapters

Notebook draft normalization/persistence lives under `biology-notebook/agent/`; generated-protocol normalization/persistence lives under `protocol/agent/`. Agent Chat consumes those owner APIs without defining either record schema itself. This folder is the best example of a renderer module that is mostly orchestration around the agent subsystem documented elsewhere in [agent/README.md](../../agent/README.md).

## `assay/`

Start in `assay/index.js`.

The folder is intentionally split by concern:

- `dom.js`: DOM lookups
- `layout-manager.js`: plate layout editing and mapping
- `results-manager.js`: result-grid ingest and synchronization
- `analysis-view.js`: charts and higher-level analysis presentation
- `plate-model.js`: normalization and plate-definition helpers
- `numbering.js`: assay numbering
- `analysis/`: pure analysis math and summary builders

The useful mental model is:

1. define the plate
2. map wells to samples/concentrations
3. paste or edit results
4. run summary/curve analysis
5. persist one normalized assay record

The pure analysis math lives under `assay/analysis/` (`index.js` plus `curve-fitters.js`, `dose-response.js`, `standard-curve.js`, `regression.js`, `grouped-summary.js`), so it can be reused and tested without the view.

## `biology-notebook/`

Start in `biology-notebook/index.js`. It is the view orchestrator; implementation files are grouped by ownership:

- `entry/`: entry normalization, naming, list/view rendering, and save-record construction
- `agent/`: assistant notebook-draft normalization, autosave, and planned-page persistence adapter
- `protocol/`: placeholder editing, snapshot editing, protocol text, and step rendering
- `project/`: project selection and dashboard rendering
- `results/`: result tables, linked assay/gel previews, PDF actions, and selection insights
- `samples/`: sample lookup, labels, and link-menu behavior
- `storage/`: imported result files and append-only page logs
- `tools/`: notebook calculation model and calculator sidebar

Cross-feature, provider-facing adapters remain under `renderer/services/`; pure table and path models remain under `renderer/lib/`.

## `papers/`

Start in `papers/index.js`.

The papers subsystem is built around a shared `context` object that is passed to specialized controllers:

- `pdf-viewer/index.js`: PDF viewer composition; its controllers, geometry, search, selection, and rendering helpers stay in the same `pdf-viewer/` package
- `library.js`: folder rail and paper list behavior
- `comments.js`: comment pins and sidebar editing
- `actions.js`: file actions, summarize actions, and higher-level mutations
- `llm.js`: paper summarization/extraction helpers
- `storage.js`, `model.js`, `normalizers.js`: storage/model cleanup support

The shape is notable because the subsystem is neither purely MVC nor purely functional. It is controller-oriented around a shared context bag.

## `sequence-viewer/`

Start in `sequence-viewer/index.js`, but treat that as an orchestrator rather than "the whole feature."

The folder has several layers:

- controllers
  - `home-controller.js`
  - `detail-controller.js`
  - `alignment-controller.js`
  - `protein-builder.js`
- parsing and domain logic
  - `parsing.js`
  - `alignment.js`
  - `restriction-analysis.js`
  - `orf-analysis.js`
  - `feature-model.js`
  - `cloning-assembly.js` and `cloning-assembly/`
  - `protein-builder/`
- rendering/layout support
  - `detail-rendering.js`
  - `detail-layout.js`
  - `detail-events.js`
  - `detail-hover.js`
  - `detail-feature-editing.js`
  - `detail-alignment.js`
- storage and shared support
  - `storage.js`
  - `translation-style.js`
  - `shared.js`
  - `service.js`: renderer registry handoff into Sequence Viewer
  - `calculations/`: sequence, oligo, protein, and CRISPR calculation cores plus Toolbox-facing UI adapters in `calculations/ui/`

This is the largest renderer subsystem by a wide margin. Read it as several cooperating tools inside one workspace:

- import/paste sequence records
- manage a local sequence library
- inspect one record in detail
- inspect features and ORFs
- run restriction analysis
- align sequences
- build proteins and plan cloning assemblies

`modules/sequence-viewer/public-api.js` is the explicit secondary surface for parsing, rendering, ORF generation, restriction analysis, alignment, and cloning planning. The manifest imports `index.js` directly and supplies the API bridge and storage path as dependencies.

Reusable plasmid annotation, ORF, restriction-site, and backbone-recognition algorithms live directly in `src/renderer/modules/sequence-viewer/algorithms/`.

## `workflow/`

Start in `workflow/index.js`.

This folder is one of the cleaner separations in the renderer:

- `model.js`: workflow normalization, template instantiation, and data helpers
- `renderer.js`: form/list rendering
- `graph-controller.js`: graph-editor interaction model
- `actions.js`: mutations and event binding
- `state.js`: small runtime state plus default-assignee resolution
- `presentation.js`: display-label helpers

The folder is worth reading if you want a more structured example than the older single-file modules.

## `tool-box/`

Start in `tool-box.js` and then immediately open `tool-box/view-manager.js`.

The toolbox is really a collection of mini-tools with two kinds of files:

- pure cross-feature calculators such as `lib/molarity.js` and `lib/bench-calculations.js`
- UI initializers such as `molarity-ui.js` and `buffer-ui.js`; sequence/protein UI adapters are owned by `modules/sequence-viewer/calculations/ui/`

Two details matter here:

- `view-manager.js` controls which tool subview is visible and lazy-loads `colony-counter.js`
- `tool-box.js` eagerly mounts only a subset of the available UI modules
