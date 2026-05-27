# Assay Module Structure

`index.js` is the public renderer entry point. It composes the assay view, keeps the exported contract small, and delegates domain behavior to focused modules.

- `artifact-storage.js`: folder-backed assay artifacts, analysis JSON, chart SVG persistence, and result-file attachment metadata.
- `analysis-view.js`: analysis workflow controller, result summaries, and analysis table rendering.
- `analysis-chart-renderer.js`: ReactVis chart model selection, chart rendering, legend/series color handling, and SVG capture.
- `chart-style-model.js`: chart style defaults, option lists, and persisted style normalization.
- `chart-style-controls.js`: chart style form bindings and control refresh logic.
- `layout-manager.js`: plate definition, axis templates, well overrides, preview events, CSV import/export, and layout state restoration.
- `plate-preview-renderer.js`: HTML generation for the editable plate grid.
- `inventory-sample-picker.js`: well context menu picker for applying inventory sample IDs.
- `serial-dilution.js`: serial dilution dialog controller and DOM rendering.
- `serial-dilution-model.js`: serial dilution grouping, recipe calculations, and summary table model.
- `results-manager.js`: result spreadsheet orchestration, paste handling, result grouping selections, and import dialog workflow.
- `result-import-detector.js`: CSV/Excel table normalization and plate-sized result matrix detection.
- `plate-model.js`: plate definitions, well IDs, layout normalization, and axis template helpers.
- `numbering.js`: assay number allocation and previews.
- `dom.js`: DOM node collection for `assay-view.html`.
- `shared.js`: small text, CSV, axis, numeric, and filename helpers.
- `concentration-utils.js`: concentration parsing and volume formatting helpers.
- `constants.js`: shared assay constants.

Maintenance notes:

- Keep `index.js` as composition glue. New storage behavior belongs in `artifact-storage.js`; new chart defaults belong in `chart-style-model.js`; new chart rendering behavior belongs in `analysis-chart-renderer.js`.
- Prefer pure helpers in `plate-model.js`, `result-import-detector.js`, and `serial-dilution-model.js` before expanding controller files.
- Source UI changes still start in `ui/html/views/assay-view.html` and `ui/css/views/assay-view.css`; rerun `npm run build:ui` after source template or renderer changes.
