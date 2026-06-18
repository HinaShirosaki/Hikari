# Lab Common Inventory Module

This folder contains the split implementation of the lab common inventory renderer.

- `index.js`: top-level module orchestration.
- `controller-context.js`: shared controller state, DOM references, and injected helpers.
- `dialog-controller.js`: chemical dialog open/close/reset behavior.
- `chemical-form.js`: chemical form hydration and submit/delete handling.
- `chemical-list-rendering.js`: location filters, list rendering, and empty states.
- `chemical-detail-rendering.js`: selected chemical detail markup.
- `blockchain-and-messages.js`: blockchain panel and transient message rendering.
- `events.js`: top-level DOM event bindings.
- `location-codes.js`: location normalization and code generation.
- `sqlite-sync.js`: sqlite bundle synchronization.
- `render-all.js`: full render/sync orchestration.
- `import-schema.js`: import field schema and aliases.
- `import-field-guessing.js`: local header heuristics.
- `import-header-mapping.js`: LLM-backed header mapping.
- `import-file-parsing.js`: CSV/TSV/XLSX file parsing.
- `import-records.js`: parsed record normalization.
- `import-flow.js`: import dialog flow and merge handling.

Maintenance notes:

- Keep `index.js` as a thin composition layer.
- Keep import-specific behavior in `import-*` files and storage behavior in `sqlite-sync.js`.
- Add UI rendering to the nearest renderer file before expanding event or controller modules.
