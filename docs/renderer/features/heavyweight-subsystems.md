# Heavyweight Subsystems

These are the renderer areas where the code is split into dedicated folders because a single-file controller would be too hard to reason about.

## At a glance

| Subsystem | Entry point | Approx. size | Mental model |
| --- | --- | --- | --- |
| `agent-chat/` | `modules/agent-chat/index.js` | about 6.4k lines | chat UI plus session/context orchestration on top of main-process agent IPC |
| `assay/` | `modules/assay/index.js` | about 9.0k lines | plate-definition editor, result grid, and analysis views (incl. `analysis/`) |
| `biology-notebook/` | `modules/biology-notebook/index.js` | about 7.0k lines | notebook entry lifecycle with focused entry, protocol, project, results, sample, storage, and tools packages |
| `gel/` | `modules/gel/index.js` | about 6.4k lines | controller-orchestrated image pipeline: ingestion, preprocessing, guided manual lane/band segmentation, auto-detection, quantification, and export |
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
- developer-tool testing UI

Subfiles are split cleanly:

- `session-manager.js`: session lifecycle and list rendering
- `rendering.js`: message/history DOM rendering
- `response.js`: normalization and summary helpers for returned agent payloads
- `state-snapshot.js`: compact experiment/context snapshot generation
- `review-overlay.js`: generic approval/rejection UI dispatched through feature adapters
- `developer-tools.js`: the developer-mode tool picker/hints

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

## `gel/`

Start in `gel/index.js`, but treat it as wiring rather than logic. The subsystem grew from a single controller into a **controller-orchestrated** design similar to `papers/`: `index.js` builds a shared `runtime` bag, constructs six controllers around it, injects cross-controller render callbacks, and binds every DOM event. Almost no analysis or rendering logic lives in `index.js` itself.

### The `runtime` bag

`index.js` creates one mutable `runtime` object (the current image, viewer mode, crop state, `manualOverrides`, the latest `currentReport`, lane-profile selection, persistence callbacks, etc.) and passes the same reference to every controller. Controllers read and mutate shared state through `runtime` instead of holding their own copies, and they call into each other through injected `deps` callbacks (`renderCanvas`, `renderReport`, `renderLaneTable`, `setStatus`, `onRunAnalysis`, ...). This is why the controllers can stay in separate files without a formal store.

### Controllers (stateful, DOM-facing)

Each is a `createXController({ runtime, elements, deps })` factory returning a small method surface:

- `images/image-controller.js`: file load, decode, enhancement settings (denoise/contrast), and the preprocessed-image cache (`getPreprocessedImageForCurrentSettings`).
- `images/crop-controller.js`: interactive crop and rotate, normalizing the canvas back into a working image.
- `manual/manual-workflow.js`: the largest controller. Owns the guided manual segmentation workflow, the viewer-tool toolbar, canvas pointer interaction (clicks, context menu, vertex dragging), auto-detect-lanes, and override status. See the workflow breakdown below.
- `rendering/lane-table.js`: the editable lane/sample table beneath the viewer.
- `rendering/index.js`: canvas drawing, the analysis report, the per-lane intensity-profile chart, the cell table, and hover overlays. `selectViewerBaseImageData(...)` (also re-exported from `index.js`) picks original vs. processed pixels for display.
- `records-manager.js`: form state, save/load of gel-analysis records, the saved-record list/search, JSON/CSV export wiring, and `startLinkedGel(...)` for notebook-linked gels.

### Pure / support modules (no DOM)

- `analysis/analysis-core.js`: the analysis engine — `analyzeGelImage(...)` plus `buildCalibration`, `applyCalibrationToBands`, `applyNormalization`, `clusterBandsAcrossLanes`, `computeLaneConfidence`, `interpretLane`, and `linearRegression`.
- `analysis/auto-lanes.js`: `detectLanes(...)` automatic lane detection.
- `analysis/image-processing.js`: histogram percentiles, range normalization, Gaussian blur, `preprocessWithJs`, polarity detection, and the quantification signal.
- `images/image-io.js`: decode and `normalizeDecodedImage` (handles multi-page TIFF).
- `shared.js`: math helpers plus the manual-override model (`createEmptyManualOverrides`, lane-vertex and lane-band-window normalization/geometry helpers).
- `export.js`: `createBandsCsv` and `downloadTextFile`.
- `manual/manual-ui.js`: small presentational helpers for the viewer toolbar and step classes.
- `dom.js`, `constants.js`, `rendering/presentation.js`: element lookups and tiny constants.

### Guided manual segmentation workflow

The headline feature is a step-by-step manual override flow driven by `manual/manual-workflow.js` and rendered as a numbered progress stepper. A viewer tool is selected, the user clicks on the canvas to place geometry, and `runtime.manualOverrides` accumulates:

1. **Set left border** / 2. **Set right border** — gel bounds (`gelLeft` / `gelRight`).
3. **Set dividers** — lane boundaries (confirmed via "Done Dividers").
4. **Set ladder lane** — which lane is the MW ladder.
5. **Ladder MW** — assign known molecular weights to ladder bands (confirmed via "Done Ladder MW").
6. **Band top** / 7. **Band bottom** — the quantification band window; supports a per-lane band mode where each lane gets its own top/bottom (progress shows `n/total` lanes).
- **Quantify** confirmation and freeform **added bands** rounds.

Additional viewer tools include **lane-vertices** (drag the four corners of a lane to correct tilt/skew, with glued shared edges between adjacent lanes). `renderOverrideStatus()` prints a compact summary line (`gel … | div … | bandY … | tilt … | add … | ladderMW … | ladder …`).

### User journey

1. Load an image (file picker or drag-and-drop onto the viewer stage).
2. Optionally crop/rotate and tune denoise/contrast; toggle **original vs. processed** view.
3. Auto-detect lanes, or run the guided manual segmentation steps.
4. Run analysis (`onRunAnalysis` → `analyzeGelImage`), which produces lanes, band groups, calibration, and confidence.
5. Inspect the report, lane table, and per-lane intensity profiles.
6. Save the normalized gel-analysis record and/or export JSON/CSV; optionally link it to a notebook page.

Consumers that need gel calculations import the specific pure module under `analysis/` or `shared.js` instead of routing through the view entry.

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
