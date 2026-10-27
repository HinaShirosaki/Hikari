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
- `manual/manual-workflow.js`: the largest controller. Owns the manual segmentation tools, the viewer-tool toolbar, canvas pointer interaction (clicks, context menu, vertex dragging), auto-detect-lanes, and override status. See the workflow breakdown below.
- `rendering/lane-table.js`: the editable lane/sample table docked above the gel, with columns aligned to the image lanes. The viewer fits into the remaining space; long tables scroll within the dock. The Lane table button in the rail's Lanes section shows or hides it, and exports compose the saved table with the gel.
- `rendering/canvas-surface.js`: preserves the native-size annotated preview while drawing the interactive image and editing marks on a separate device-pixel canvas. Screen-space strokes, labels, dashes and handles keep a fixed size after crop or resize. The input canvas remains the pointer target and source-coordinate reference. Display resizing never commits analysis history; disposal removes the layer and observers.
- `rendering/ladder-labels.js`: opt-in export annotations from explicitly marked ladder bands. It maps rectified ladder rows back through saved lane vertices, applies each clip's crop and image scale, and places text and exact-position ticks in a separate gutter. Crowded text uses leaders; PNG and editable PowerPoint annotations share the same geometry. The export-menu switch is view state outside the saved Gel form.
- `rendering/index.js`: canvas drawing, the per-lane intensity-profile chart, the Band intensity window's graph and table, and hover overlays. `selectViewerBaseImageData(...)` (also re-exported from `index.js`) picks original vs. processed pixels for display.
- `floating-windows.js`: owns the nonmodal Band integration and Band intensity windows, opened from Results. Each is bounded to the image stage, supports pointer dragging and arrow-key movement from its title bar, and Escape closes the top window. Band intensity shows a bar graph above a copyable Lane/Label/Band intensity table; both use the same background-corrected measurements. Rendering remains owned by the existing controllers; opening or dismissing a window does not resize the gel. Observers and pointer listeners are disposed with the workspace.
- `history.js`: the frame's own undo/redo stack over `manualOverrides`. `commit()` runs after every render and is a no-op unless the overrides actually moved, so no call site has to decide whether an interaction was an edit. A changed `runtime.imageRevision` (load, crop, rotate) drops the stack rather than replaying coordinates onto different pixels.
- `records-manager.js`: form state, save/load of plugin-owned gel-analysis records, saved-record list/search, CSV export wiring, and compatibility metadata retained on migrated records. It does not call Notebook or other host modules.

### Pure / support modules (no DOM)

- `analysis/analysis-core.js`: the analysis engine — `analyzeGelImage(...)` plus `buildCalibration`, `applyCalibrationToBands`, `applyNormalization`, `clusterBandsAcrossLanes`, `computeLaneConfidence`, `interpretLane`, and `linearRegression`.
- `analysis/lane-signal.js`: versioned target-band quantification uses original float grayscale, local median background strips that follow a descending tail to the first stable valley, and interpolation at the actual strip rows. A completed same-lane Band integration baseline enclosing the target takes priority. Signed net intensity and background quality are retained; unavailable background is null. Review measurements are excluded from normalization denominators. Band integration edits rerun the derived report and support manual undo/redo. Legacy reports are upgraded from source pixels before capturing the editor's clean signature.
- `analysis/auto-lanes.js`: `detectLanes(...)` automatic lane detection combines overlapping height windows with column-background contrast, centers flat peaks, rejects shallow splits, and selects a compatible set of peaks. Expected-count reconstruction labels inferred blank lanes and reports unresolved count mismatches. Explicit outer boundaries can resolve blank edge lanes; without them the detector does not guess their location. Preview contrast settings do not affect detection.
- `analysis/image-processing.js`: histogram percentiles, range normalization, Gaussian blur, `preprocessWithJs`, polarity detection, and the quantification signal.
- `images/image-io.js`: decode and `normalizeDecodedImage` (handles multi-page TIFF). Single-channel 16-bit TIFFs keep a full-precision float `gray` (the 8-bit `imageData` is display only); resize and `cropGray` work on that float image, replaying Cropper.js's rotation. Saving such a gel also writes `source-16bit.tif` beside `source.png`, fingerprinted with that PNG; reopening restores the 16-bit grey only when the fingerprint still matches.
- `shared.js`: math helpers plus the manual-override model (`createEmptyManualOverrides`, lane-vertex and lane-band-window normalization/geometry helpers).
- `export.js`: `createBandsCsv` and `downloadTextFile`.
- `manual/manual-ui.js`: small presentational helpers for the viewer toolbar and step classes.
- `dom.js`, `constants.js`: element lookups and tiny constants.

### Manual segmentation tools

The headline feature is a set of manual override tools driven by `manual/manual-workflow.js`. A canvas click acts only for the pressed viewer tool (`runtime.selectedViewerTool`); with none pressed it does nothing, so there are no hidden steps. Each click places geometry, and `runtime.manualOverrides` accumulates. The pieces are independent; the order below is the usual one:

1. **Set dividers** — lane boundaries, with the outermost dividers also defining
   the gel edges. The green **Dividers** tool (rail → Lanes) means editing is
   active and the canvas shows a column-resize cursor; **Finish dividers** at the
   top of the tools panel, or clicking the tool again, finishes it.
2. **Set ladder lane** — which lane is the MW ladder (rail → Ladder → Pick lane;
   the tool releases after one click). Optional: **Detect** and **Set MW** stay
   disabled until a ladder lane exists.
3. **Ladder MW** — toggle **Set MW** in the Ladder section, then click a band in the
   ladder lane to enter its MW in a single inline number field (Enter saves,
   Escape dismisses). The cursor becomes a
   crosshair while the tool is on. Clicking an existing label edits its value;
   dragging it moves the calibration row.
4. **Top** / 5. **Bottom** (rail → Bands) — the quantification band window. Top
   hands off to Bottom after its click. Per-lane band mode gives each lane its own
   top/bottom; Bottom hands back to Top until every lane has a window (progress
   shows `n/total` lanes). Analysis runs as soon as a window is complete.

Saved `addedBands` (single-row bands from older records) are still measured, but
no tool adds new ones.

Additional viewer tools include **lane-vertices** (drag the four corners of a lane to correct tilt/skew, with glued shared edges between adjacent lanes). `renderOverrideStatus()` prints a compact summary line (`gel … | div … | bandY … | tilt … | add … | ladderMW … | ladder …`).

### User journey

1. Load an image (file picker or drag-and-drop onto the viewer stage).
2. Optionally crop/rotate and tune denoise/contrast; toggle **original vs. processed** view.
3. Auto-detect lanes, or place them with the manual tools.
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
