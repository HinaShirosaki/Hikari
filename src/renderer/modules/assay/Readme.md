# Assay Module Structure

`index.js` is the public renderer entry point. It composes the assay view, keeps the exported contract small, and delegates domain behavior to focused modules.

- `artifact-storage.js`: folder-backed assay artifacts, analysis JSON, chart SVG persistence, and result-file attachment metadata.
- `analysis-view.js`: analysis workflow controller, result summaries, analysis table rendering, and direct Plotly lifecycle ownership.
- `analysis-chart-model.js`: pure chart-model selection for Assay analysis results.
- `derived-plate.js`: pure plate transforms plus the well-reference grammar. The active UI stores one formula per transformed cell; bare references and `Table1` read Plate Results, while `Table2` reads computed transformed cells with cycle detection. Legacy guided-step and global-formula specs remain readable. Analysis reads the transformed numeric plate whenever cell formulas are active.
- The spreadsheet-style formula language lives in `src/renderer/lib/formula.js` — tokenizer, recursive-descent parser, and AST evaluator, shared with notebook result tables. Never uses `eval`. Function names and arity are checked at parse time so typos surface while typing. `derived-plate.js` supplies the plate-specific `resolveRef`.
- `plotly/`: Assay-owned Plotly rendering and figure formatting. `plotly-renderer.js` draws and exports the figure; `chart-style-model.js` / `chart-style-store.js` hold the style state and the rendered-figure context the controls key off; `chart-toolbar.js` is the strip above the chart; `chart-controls.js` is the tabbed Format rail page; `chart-presets.js` stores named styles; `chart-style-pickers.js` and `chart-text-controls.js` are the shared visual pickers.
- `analysis/`: pure analysis math. `grouping.js` owns the analysis spec (`groupBy` / `xAxis` / `analysis` plus modifiers), legacy method migration, and the grouping every analysis shares; `grouped-summary.js` is the one summary table; `curve-fit.js` is the one curve runner (linear / sigmoidal / hyperbola / polynomial / Pade); `dose-response.js` is normalize-to-baseline; `curve-fitters.js` holds the fitters themselves.
- `layout-manager.js` plus `layout/`: plate definition, concentration fill, CSV mapping, preview events, and layout state restoration.
- `plate-preview-renderer.js`: HTML generation for the editable plate grid.
- `inventory-sample-picker.js`: well context menu picker for applying inventory sample IDs.
- `serial-dilution.js`: serial dilution dialog controller and DOM rendering.
- `serial-dilution-model.js`: serial dilution grouping, recipe calculations, and summary table model.
- `results-manager.js` plus `results/`: result spreadsheet orchestration, grid model, paste handling, and import workflow.
- `result-import-detector.js`: CSV/Excel table normalization and plate-sized result matrix detection.
- `plate-model.js`: plate definitions, well IDs, layout normalization, and axis template helpers.
- `numbering.js`: assay number allocation and previews.
- `ui/`: browser-view rendering and top-level event bindings.
- `dom.js`: DOM node collection for `assay-view.html`.
- `shared.js`: small text, CSV, axis, numeric, and filename helpers.
- `concentration-utils.js`: concentration parsing and volume formatting helpers.
- `constants.js`: shared assay constants.

Maintenance notes:

- Keep `index.js` as composition glue. New storage behavior belongs in `artifact-storage.js`; Plotly rendering belongs in `plotly/`; pure math belongs in `analysis/`.
- Prefer pure helpers in `plate-model.js`, `result-import-detector.js`, and `serial-dilution-model.js` before expanding controller files.
- Source UI changes still start in `ui/html/views/assay-view.html` and `ui/css/views/assay-view.css`; rerun `npm run build:ui` after source template or renderer changes.
