# Heavyweight Subsystems

These are the renderer areas where the code is split into dedicated folders because a single-file controller would be too hard to reason about.

## At a glance

| Subsystem | Entry point | Approx. size | Mental model |
| --- | --- | --- | --- |
| `agent-chat/` | `modules/agent-chat.js` -> `agent-chat/index.js` | about 2.4k lines | chat UI plus session/context orchestration on top of main-process agent IPC |
| `assay/` | `modules/assay.js` -> `assay/index.js` | about 4.7k lines | plate-definition editor, result grid, and analysis views |
| `gel/` | `modules/gel-analysis.js` -> `gel/index.js` | about 3.0k lines | image ingestion, preprocessing, lane/band analysis, and export |
| `papers/` | `modules/papers-management.js` -> `papers/index.js` | about 3.1k lines | library rail, PDF viewer, comments, paper actions, and LLM helpers |
| `sequence-viewer/` | `modules/sequence-viewer.js` -> `sequence-viewer/index.js` | about 9.3k lines | file parsing, library storage, detailed sequence inspection, alignment, annotation, and analysis |
| `workflow/` | `modules/workflow-management.js` -> `workflow/index.js` | about 2.2k lines | workflow data model, graph editor, list rendering, and actions |
| `tool-box/` | `modules/tool-box.js` | about 7.3k lines | many small calculator/analysis tools sharing one workspace shell |

## `agent-chat/`

Start in `agent-chat/index.js`.

That file owns the renderer-side chat experience:

- project-scoped context selection
- history rendering
- deep-research toggle
- session selection and creation
- notebook-draft creation from assistant responses
- developer-tool testing UI

Subfiles are split cleanly:

- `session-manager.js`: session lifecycle and list rendering
- `rendering.js`: message/history DOM rendering
- `response.js`: normalization and summary helpers for returned agent payloads
- `state-snapshot.js`: compact experiment/context snapshot generation
- `notebook-drafts.js`: notebook-draft extraction, autosave, and proposal reconciliation
- `developer-tools.js`: the developer-mode tool picker/hints

This folder is the best example of a renderer module that is mostly orchestration around another subsystem documented elsewhere in [doc/agent/README.md](../../agent/README.md).

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

`modules/assay-analysis.js` exists as a stable pure-function wrapper around `assay/analysis/index.js`.

## `gel/`

Start in `gel/index.js`.

This subsystem mixes UI control with a real analysis pipeline:

- `image-io.js`: file decode and image normalization
- `image-processing.js`: preprocessing and enhancement
- `analysis-core.js`: lane detection, calibration, clustering, confidence scoring, and interpretation
- `export.js`: JSON and CSV export
- `dom.js` and `shared.js`: DOM references plus small shared helpers

`gel/index.js` owns the user journey:

- load image
- crop or adjust enhancement
- optionally apply manual overrides
- run analysis
- save/export the resulting gel-analysis record

`modules/gel-analysis.js` wraps the folder with both `initGelAnalysis(...)` and many pure helper re-exports, which is a hint that parts of the gel pipeline are used outside the view itself.

## `papers/`

Start in `papers/index.js`.

The papers subsystem is built around a shared `context` object that is passed to specialized controllers:

- `pdf-viewer.js`: canvas/page rendering and page navigation
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
- rendering/layout support
  - `detail-rendering.js`
  - `detail-layout.js`
  - `detail-events.js`
  - `detail-hover.js`
  - `detail-feature-editing.js`
  - `detail-alignment.js`
- storage and annotation support
  - `storage.js`
  - `plannotate.js`
  - `translation-style.js`
  - `shared.js`

This is the largest renderer subsystem by a wide margin. Read it as several cooperating tools inside one workspace:

- import/paste sequence records
- manage a local sequence library
- inspect one record in detail
- annotate features and ORFs
- run restriction analysis
- align sequences
- build proteins
- hand off to local or bridge-backed annotation helpers

`modules/sequence-viewer.js` is also a wrapper layer. It injects the `window.enanaApi` bridge and re-exports many pure helpers for parsing, rendering, ORF generation, restriction analysis, and alignment.

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

- pure calculators and sequence helpers such as `molarity.js`, `sequence.js`, `crispr.js`, `cloning-assembly.js`, and `protein-assembly.js`
- UI initializers such as `molarity-ui.js`, `translation-ui.js`, `crispr-ui.js`, and `buffer-ui.js`

Two details matter here:

- `view-manager.js` controls which tool subview is visible and lazy-loads `colony-counter.js`
- `tool-box.js` eagerly mounts only a subset of the available UI modules

That means the folder contains more capability than the default toolbox boot path immediately activates. In particular, `plannotate-ui.js` and `protein-assembly-ui.js` exist, but `initToolBox()` does not currently call them.
