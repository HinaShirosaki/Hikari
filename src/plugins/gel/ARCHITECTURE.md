# Gel subsystem architecture

Moved here from `docs/renderer/features/heavyweight-subsystems.md` when Gel
stopped being a renderer module. Paths below are relative to the plugin-owned
`workspace/` folder.

Start in `workspace/index.js`, but treat it as wiring rather than logic. The subsystem grew from a single controller into a **controller-orchestrated** design similar to `papers/`: `index.js` builds a shared `runtime` bag, constructs six controllers around it, injects cross-controller render callbacks, and binds every DOM event. Almost no analysis or rendering logic lives in `index.js` itself.

### The `runtime` bag

`index.js` creates one mutable `runtime` object (the current image, viewer mode, crop state, `manualOverrides`, the latest `currentReport`, lane-profile selection, persistence callbacks, etc.) and passes the same reference to every controller. Controllers read and mutate shared state through `runtime` instead of holding their own copies, and they call into each other through injected `deps` callbacks (`renderCanvas`, `renderLaneTable`, `setStatus`, `onRunAnalysis`, ...). This is why the controllers can stay in separate files without a formal store.

### Controllers (stateful, DOM-facing)

Each is a `createXController({ runtime, elements, deps })` factory returning a small method surface:

- `images/image-controller.js`: file load, decode, enhancement settings (denoise/contrast), and the preprocessed-image cache (`getPreprocessedImageForCurrentSettings`).
- `images/crop-controller.js`: interactive crop and rotate, normalizing the canvas back into a working image.
- `manual/manual-workflow.js`: the largest controller. Owns the guided manual segmentation workflow, the viewer-tool toolbar, canvas pointer interaction (clicks, context menu, vertex dragging), auto-detect-lanes, and override status. See the workflow breakdown below.
- `rendering/lane-table.js`: the editable lane/sample table beneath the viewer.
- `rendering/index.js`: canvas drawing, the per-lane intensity-profile chart, the cell table, and hover overlays. `selectViewerBaseImageData(...)` (also re-exported from `index.js`) picks original vs. processed pixels for display.
- Dialogs: the peak editor and per-cell band intensity view each live in an overlay opened from **Gel Tools -> Analysis**, so neither takes permanent workspace height. Their triggers disable when the underlying data is missing, and closing follows the same open/close/overlay-click/Escape shape.
- `history.js`: the frame's own undo/redo stack over `manualOverrides`. `commit()` runs after every render and is a no-op unless the overrides actually moved, so no call site has to decide whether an interaction was an edit. A changed `runtime.imageRevision` (load, crop, rotate) drops the stack rather than replaying coordinates onto different pixels.
- `records-manager.js`: form state, save/load of plugin-owned gel-analysis records, saved-record list/search, CSV export wiring, and compatibility metadata retained on migrated records. It does not call Notebook or other host modules.

### Pure / support modules (no DOM)

- `analysis/analysis-core.js`: the analysis engine — `analyzeGelImage(...)` plus `buildCalibration`, `applyCalibrationToBands`, `applyNormalization`, `clusterBandsAcrossLanes`, `computeLaneConfidence`, `interpretLane`, and `linearRegression`.
- `analysis/auto-lanes.js`: `detectLanes(...)` automatic lane detection.
- `analysis/image-processing.js`: histogram percentiles, range normalization, Gaussian blur, `preprocessWithJs`, polarity detection, and the quantification signal.
- `images/image-io.js`: decode and `normalizeDecodedImage` (handles multi-page TIFF).
- `shared.js`: math helpers plus the manual-override model (`createEmptyManualOverrides`, lane-vertex and lane-band-window normalization/geometry helpers).
- `export.js`: `createBandsCsv` and `downloadTextFile`.
- `manual/manual-ui.js`: small presentational helpers for the viewer toolbar and step classes.
- `dom.js`, `constants.js`: element lookups and tiny constants.

### Guided manual segmentation workflow

The headline feature is a step-by-step manual override flow driven by `manual/manual-workflow.js` and rendered as a numbered progress stepper. A viewer tool is selected, the user clicks on the canvas to place geometry, and `runtime.manualOverrides` accumulates:

1. **Set dividers** — lane boundaries, with the outermost dividers also defining
   the gel edges. The green **Lane dividers** tool means editing is active;
   clicking it again finishes the step.
2. **Set ladder lane** — which lane is the MW ladder (Gel Tools → Lane → Ladder lane).
3. **Ladder MW** — assign known molecular weights to ladder bands (confirmed
   via "Done Ladder MW").
4. **Band top** / 5. **Band bottom** — the quantification band window; supports
   a per-lane band mode where each lane gets its own top/bottom (progress shows
   `n/total` lanes).
- **Quantify** confirmation and freeform **added bands** rounds.

Additional viewer tools include **lane-vertices** (drag the four corners of a lane to correct tilt/skew, with glued shared edges between adjacent lanes). `renderOverrideStatus()` prints a compact summary line (`gel … | div … | bandY … | tilt … | add … | ladderMW … | ladder …`).

### User journey

1. Load an image (file picker or drag-and-drop onto the viewer stage).
2. Optionally crop/rotate and tune denoise/contrast; toggle **original vs. processed** view.
3. Auto-detect lanes, or run the guided manual segmentation steps.
4. Run analysis (`onRunAnalysis` → `analyzeGelImage`), which produces lanes, band groups, calibration, and confidence.
5. Inspect the report, lane table, and per-lane intensity profiles.
6. Save the normalized plugin-owned record and/or export CSV.

Code inside the plugin that needs gel calculations imports the specific pure
module under `analysis/` or `shared.js` instead of routing through the view
entry. Renderer modules must not import across the plugin boundary.

## Host boundary and intentional compatibility code

The Gel controller, UI, analysis pipeline, and record manager live entirely in
`src/plugins/gel`. Gel-specific code elsewhere under `src/` is boundary code,
not another implementation:

- `renderer/lib/bundled-plugins.js` declares the bundled plugin record.
- `main/core/main-services.js` resolves the packaged folder behind the private
  `@bundled/gel` token.
- `renderer/app/plugin-bridge.js` contains the identity-locked, one-time legacy
  migration into plugin storage.
- `renderer/app/plugin-bridge.js` also runs the Notebook "Add gel" handoff:
  `queueNotebookGel` holds the page and sends a data-less `gel.notebookLink`
  event; the plugin (`main.js`) pulls the page with the internal, one-shot
  `gel.takeNotebookLink` verb and starts a page-linked analysis.
- `renderer/lib/gel-records.js` is a host-owned read model for displaying
  plugin records in existing notebook, project, PDF, home, and Agent surfaces.
- `state.gelAnalyses` and its storage normalizers remain readable so pre-port
  snapshots can migrate without data loss. The plugin never writes that branch.

There is no Gel renderer module, built-in Gel view id, topbar record search,
or Agent sub-app API. Host readers can display new plugin records through
`renderer/lib/gel-records.js` and fall back to historical pre-port records until
migration. That is one-way host presentation, not an API the plugin can call.
