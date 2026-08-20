# Renderer Libraries

Pure, cross-feature helpers live here. They must not import feature controllers.

- primitives: CSV, HTML, JSON, numeric normalization, and unit conversions
- shared bench calculations: molarity, buffers, and fixed-reaction recipes
- interaction/state: file-drop and unsaved-draft helpers
- record models: inventory settings/containers, notebook result tables, and storage paths
- `formula.js`: the spreadsheet formula language (tokenizer, parser, AST evaluator, never
  `eval`). Callers supply `resolveRef` for their own addressing — plate wells in Assay,
  A1 cells in `notebook-table-formulas.js`.
- datasets: `chemistry/`

Code that coordinates feature APIs or provider calls belongs in `renderer/services/` instead.
