# Heavyweight Subsystems

These are the renderer areas where the code is split into dedicated folders because a single-file controller would be too hard to reason about.

## At a glance

| Subsystem | Entry point | Approx. size | Mental model |
| --- | --- | --- | --- |
| `agent-chat/` | `modules/agent-chat/index.js` | about 7.2k lines | chat UI plus session/context orchestration on top of main-process agent IPC |
| `assay/` | `modules/assay/index.js` | about 13.9k lines | plate-definition editor, result grid, derived plates, Plotly charts, and analysis views (incl. `analysis/`) |
| `biology-notebook/` | `modules/biology-notebook/index.js` | about 11.3k lines | notebook entry lifecycle with focused entry, notebook, protocol, project, results, sample, spreadsheet-table, storage, and tools packages |
| `papers/` | `modules/papers/index.js` | about 9.0k lines | library rail, PDF viewer, comments, paper actions, research brief, and LLM helpers |
| `sequence-viewer/` | `modules/sequence-viewer/index.js` | about 39.8k lines | file parsing, library, detail inspection and editing, alignment, annotation, cloning design, Protein Builder, Vector Builder, and the agent's sequence tools |
| `workflow/` | `modules/workflow/index.js` | about 4.4k lines | workflow data model, graph editor, run ledger, list rendering, and actions |
| `tool-box/` | `modules/tool-box/index.js` | about 3.6k lines | eight small calculators and the colony counter sharing one workspace shell |

> Sizes are approximate and drift as subsystems grow. Regenerate a current snapshot with `find src/renderer/modules/<name> -name '*.js' | xargs wc -l` when in doubt.

## `agent-chat/`

Start in `agent-chat/index.js`.

That file owns the renderer-side chat experience:

- project-scoped context selection
- history rendering
- session selection and creation
- review-card presentation and dispatch to feature-owned agent adapters

Subfiles are split cleanly:

- `session-manager.js`, `session-folders.js`, `session-loading.js`: session lifecycle, folders, and list rendering
- `agent-request-controller.js`, `payload-builder.js`: building and sending `agent:chat` requests
- `rendering.js` and `rendering-*.js`: message/history DOM rendering, including tool traces, drafts, purchase and Python results, and question cards
- `live-progress-*.js`: streaming progress from `agent-progress` events
- `html-artifacts.js`, `image-artifacts.js`, `plotly-artifacts.js`: inline artifact rendering (HTML runs in the sandboxed `hikari-html://` preview)
- `response.js` and `response/`: normalization and summary helpers for returned agent payloads
- `state-snapshot.js`, `experiment-llm-mapper.js`, `context-mappers.js`: compact experiment/context snapshot generation
- `review-overlay.js` and `review-overlay/`: generic approval/rejection UI dispatched through feature adapters
- `scoped-state.js`, `public-api.js`: the public surface other modules use to mount an independent chat (the side rail and Home's **Prepare notebook page** dialog)

Notebook draft normalization/persistence lives under `biology-notebook/agent/`; generated-protocol normalization/persistence lives under `protocol/agent/`. Agent Chat consumes those owner APIs without defining either record schema itself. This folder is the best example of a renderer module that is mostly orchestration around the agent subsystem documented elsewhere in [agent/README.md](../../agent/README.md).

## `assay/`

Start in `assay/index.js`.

The folder is intentionally split by concern:

- `dom.js`, `ui/`: DOM lookups, browser view, and event binding
- `layout-manager.js` and `layout/`: plate layout editing, concentration fill, and mapping
- `serial-dilution.js`, `serial-dilution-model.js`: the serial dilution dialog
- `inventory-sample-picker.js`: apply a sample from Samples to a well
- `results-manager.js`, `results/`, `result-import-detector.js`: result-grid ingest, file import detection, and synchronization
- `derived-plate.js` and `derived-plate/`: transformed plates with one spreadsheet formula per cell
- `analysis-view.js` and `analysis-view/`: charts and higher-level analysis presentation
- `plotly/`: Plotly rendering, the Format rail, style presets, and the live-plot controller the agent drives
- `plate-model.js`: normalization and plate-definition helpers
- `workspace/`, `artifact-storage.js`: workspace forms, notebook links, and analysis/chart files in the storage root
- `numbering.js`: assay numbering
- `agent/`: the context the agent rail reads for the open plate
- `analysis/`: pure analysis math and summary builders

The useful mental model is:

1. define the plate
2. map wells to samples/concentrations
3. paste or edit results
4. run summary/curve analysis
5. persist one normalized assay record

The pure analysis math lives under `assay/analysis/` (`index.js` plus `curve-fitting.js`, `curve-fitters.js`, `dose-response.js`, `grouped-summary.js`, `statistics.js`, `plate-stats.js`, ...), so it can be reused and tested without the view.

## `biology-notebook/`

Start in `biology-notebook/index.js`. It is the view orchestrator; implementation files are grouped by ownership:

- `notebook/`: the view's controllers — experiment dialog, entry actions, saving, result files, sample links, protocol editing, page naming, and agent context/append
- `entry/`: entry normalization, naming, list/view rendering, and save-record construction
- `agent/`: assistant notebook-draft normalization, autosave, and the saved-page append adapter other modules reuse
- `protocol/`: placeholder editing, snapshot editing, protocol text, and step rendering
- `project/`: project selection, dashboard rendering, experiment suggestions, and the project paper finder
- `results/`: linked assay/gel previews, linked-work actions, result-file attachments, and selection insights
- `spreadsheet-tables/`: the result-table grid (columns, context menu)
- `samples/`: sample lookup, labels, and link-menu behavior
- `storage/`: imported result files and append-only page logs
- `tools/`: notebook calculation model and calculator sidebar

Cross-feature, provider-facing adapters remain under `renderer/services/`; pure table and path models remain under `renderer/lib/`.

## `papers/`

Start in `papers/index.js`.

The papers subsystem is built around a shared `context` object that is passed to specialized controllers:

- `pdf-viewer/index.js`: PDF viewer composition; its controllers, geometry, search, selection, and rendering helpers stay in the same `pdf-viewer/` package
- `library.js`, `library-events.js`, `library-folder-menu.js`: folder rail and paper list behavior
- `comments.js`: comment pins and sidebar editing
- `actions.js`, `actions-upload.js`, `actions-analysis.js`: file actions, uploads, summarize/extract actions, and higher-level mutations
- `research-brief.js`: the project research brief
- `workspace-controls.js`: viewer/workspace layout controls
- `agent-context.js`: what the agent rail reads for the open paper
- `management/`: discovery of stored PDFs, discovery merge, external links, and search text
- `llm.js`, `paper-prompts.json`: paper summarization/extraction helpers and their prompts
- `storage.js`, `model.js`, `normalizers.js`, `pdf-metadata.js`: storage/model cleanup support

The shape is notable because the subsystem is neither purely MVC nor purely functional. It is controller-oriented around a shared context bag.

## `sequence-viewer/`

Start in `sequence-viewer/index.js`, but treat that as an orchestrator rather than "the whole feature."

The folder has several layers:

- controllers and orchestration
  - `home-controller.js` and `home/` (library rail, file open)
  - `detail-controller.js`
  - `alignment-controller.js`
  - `protein-builder.js` and `protein-builder/`
  - `vector-builder/` (interactive plasmid map workspace)
  - `runtime/` (controller setup, record/navigation/edit workflows, library persistence, agent-action handling)
- parsing and domain logic
  - `parsing.js` and `parsing/` (GenBank, FASTA/FASTQ, AB1)
  - `alignment.js` and `alignment/`
  - `restriction-analysis.js`, `orf-analysis.js`, `feature-model.js`
  - `cloning-assembly.js` and `cloning-assembly/` (routes, Gibson/Golden Gate/restriction-ligation, mutagenesis, primer design)
  - `cloning-design.js`, `cloning-design/`, `cloning-design-notebook/`, `protein-builder-cloning/` (design dialogs and the notebook records they write)
  - `primer-*.js` (primer naming, annotation, oligo properties, IDT order export)
  - `mcp/` (browser-safe edit, builder, and primer modules shared with the agent's Node-side sequence tools)
- rendering/layout support
  - `rendering.js` and `rendering/`
  - `detail-rendering.js`, `detail-layout.js`, `detail-hover.js`
  - `detail-events.js` and `detail-events/`
  - `detail-feature-editing.js` and `detail-feature-editing/`, `detail-sequence-editing.js`, `detail-amino-acid-editing.js`
  - `detail-alignment.js` and `detail-alignment/` (including AB1 trace rows)
- storage and shared support
  - `storage.js`
  - `translation-style.js`
  - `shared.js`
  - `service.js`: renderer registry handoff into Sequence Viewer
  - `calculations/`: sequence, oligo, protein, fold, codon-optimizer, and CRISPR calculation cores (Toolbox imports them directly)
  - `data/`: the commercial restriction-enzyme catalog and common promoters
  - `main-process/`: the Node-only library and agent tools (see [sequence-library.md](../../main-platform/sequences/sequence-library.md))

This is the largest renderer subsystem by a wide margin. Read it as several cooperating tools inside one workspace:

- import/paste sequence records
- manage a local sequence library
- inspect one record in detail
- inspect features and ORFs
- run restriction analysis
- align sequences
- build proteins and plan cloning assemblies
- edit a plasmid on its map (Vector Builder)

`modules/sequence-viewer/public-api.js` is the explicit secondary surface for parsing, rendering, ORF generation, restriction analysis, alignment, and cloning planning. The manifest imports `index.js` directly and supplies the API bridge and storage path as dependencies.

Reusable plasmid annotation, ORF, restriction-site, and backbone-recognition algorithms live directly in `src/renderer/modules/sequence-viewer/algorithms/`. They are process-neutral: the main-process library imports them too.

## `workflow/`

Start in `workflow/index.js`.

This folder is one of the cleaner separations in the renderer:

- `model.js`: workflow normalization, template instantiation, and data helpers
- `renderer.js` and `renderer/`: form/list rendering
- `graph-controller.js` and `graph/`: graph-editor interaction model and drawing
- `actions.js` and `actions/`: mutations and event binding, the template editor, step state, and the run ledger
- `execution.js`, `process-dialog.js`: running a workflow and the step drawer
- `artifact-storage.js`: result files in the storage root
- `state.js`: small runtime state plus default-assignee resolution
- `presentation.js`: display-label helpers

The folder is worth reading if you want a more structured example than the older single-file modules.

## `tool-box/`

Start in `tool-box/index.js` and then immediately open `tool-box/view-manager.js`.

The toolbox is really a collection of mini-tools with two kinds of files:

- pure calculators: `lib/molarity.js` and `lib/bench-calculations.js` for bench math, and `sequence-viewer/calculations/` for sequence, oligo, and protein math
- UI initializers in `tool-box/`: `molarity-ui.js`, `buffer-ui.js`, `fixed-reaction-ui.js`, `peptide-tool.js`, `translation-tool.js`, `oligo-tool.js`, and `extinction-tool.js`

Three details matter here:

- `view-manager.js` controls which tool subview is visible and lazy-loads `colony-counter.js`
- `index.js` mounts the seven calculator panels eagerly; the colony counter is the only lazy one
- `qpcr-ui.js` and `sequence-viewer/calculations/ui/crispr-tool.js` are calculator panels with no markup in the Tools view today; their math (`qpcr.js`, `calculations/crispr.js`) is still covered by the edge tests
