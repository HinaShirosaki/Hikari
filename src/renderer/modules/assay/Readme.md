# Assay Module Structure

`index.js` is the public renderer entry point. It composes the assay view, keeps the exported contract small, and delegates domain behavior to focused modules.

- `artifact-storage.js`: folder-backed assay artifacts, analysis JSON, chart SVG persistence, and result-file attachment metadata.
- `analysis-view.js`: analysis workflow controller, result summaries, analysis table rendering, and direct Plotly lifecycle ownership.
- `analysis-chart-model.js`: pure chart-model selection for Assay analysis results.
- `plotly/`: Assay-owned Plotly rendering, style state, controls, and SVG capture.
- `analysis/`: pure curve fitting, dose response, grouped summaries, regression, and standard-curve math.
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
