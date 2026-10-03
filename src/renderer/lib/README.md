# Renderer Libraries

Pure, cross-feature helpers live here. They must not import feature controllers.

- primitives: CSV, HTML, JSON, numeric normalization, and unit conversions
- shared bench calculations: molarity, buffers, and fixed-reaction recipes
- interaction/state: file-drop and unsaved-draft helpers
- record models: inventory settings/containers, sample records, plate wells, cell passage, compound structures, protocol snapshots, notebook result tables and PDF settings, and storage paths
- plugins: `bundled-plugins.js` (the bundled Gel definition), `plugin-storage.js` (per-plugin storage size guard), and `gel-records.js` (the one reader for Gel plugin records)
- `agent-availability.js`: the Codex gate. Settings records the login state on `<body data-agent-availability>`; CSS hides `.hikari-agent-action` and `[data-requires-agent]` until it reads `connected`, and code checks `isAgentAvailable()` before any background model call
- UI helpers without feature knowledge: `notify.js` (transient notices), `search-field-lens.js`, `folder-tree.js`, `spreadsheet-fill-handle.js`, `table-units.js`
- `formula.js`: the spreadsheet formula language (tokenizer, parser, AST evaluator, never
  `eval`). Callers supply `resolveRef` for their own addressing — plate wells in Assay,
  A1 and `TableN:A1` cells in `notebook-table-formulas.js`.
- `spreadsheet-reference-picker.js`: reusable click-to-insert point mode. Notebook and
  Assay provide their own DOM-to-address mapping while sharing the event lifecycle.
- datasets: `chemistry/`

Code that coordinates feature APIs or provider calls belongs in `renderer/services/` instead.
