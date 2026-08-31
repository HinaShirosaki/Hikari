# Sequence Viewer

This folder owns the renderer-side Sequence Viewer workspace and its feature-specific domain logic.

- `cloning-assembly.js` and `cloning-assembly/`: cloning route evaluation, primer design, and assembly planning.
- `protein-builder.js` and `protein-builder/`: protein construct composition, DNA generation, and plasmid assembly workflows.
- `vector-builder/`: the Vector Builder workspace — an interactive sequence map paired with the base-level viewer. It reuses `detail-sequence-editing.js` against its own dialog, so base edits behave identically to the detail workspace; annotation editing itself stays in the detail workspace. Replace Feature on the map searches the same stored feature database Protein Builder uses (`sequenceLibrarySearchFeatures`) and splices the chosen feature over the selected annotation, reverse-complementing it when the target site is on the minus strand. Protein Builder folds in here: a site picked on the map becomes an insert target that splices a built construct into the open vector instead of assembling against a stored backbone.
- `vector-builder/map-hover.js`: hover readout naming the feature under the pointer, shared by both maps. Short features — primer binding sites especially — are slivers on a multi-kb plasmid, so the arc alone cannot be matched to its name in the label column. Feature arcs carry the name in `aria-label` rather than a `<title>` child, so this replaces the native tooltip instead of doubling up with it.
- `vector-builder/map-zoom.js`: pinch / Ctrl+scroll zoom shared by the Vector Builder map and the library preview. Zoom scales the SVG's layout box inside a scrolling host, so panning is native scrolling and the fixed viewBox keeps `resolveBaseFromPoint` exact at any zoom or scroll offset. Zoom-to-cursor anchors by round-tripping a viewBox point through the SVG's own `getScreenCTM()`, because `preserveAspectRatio` rescales the drawing inside its box by a different factor than the box itself grows whenever a scrollbar changes the box aspect.
- `vector-builder/sequence-map.js`: the single map renderer — a plasmid ring for circular records, a linear track for everything else. It emits inline SVG (no iframe, no generated preview document), so the same code backs the library preview, the backbone dialog, and the interactive workspace, and every map inherits app theming. Library previews are drawn from each entry's stored `.gbk` at render time; nothing about a preview is persisted.
- `algorithms/`: renderer-only algorithms such as AB1 trace post-processing.
- `calculations/`: sequence, oligo, protein, codon-usage, and CRISPR calculation cores; `calculations/ui/` holds their Toolbox-facing adapters.
- `service.js`: renderer registry handoff into Sequence Viewer.
- `data/`: restriction enzyme and exported standard-feature datasets.
- `runtime/`: Sequence Viewer orchestration, persistence actions, navigation, and event binding.
- `main-process/`: Node-only filesystem and SQLite persistence used through IPC; browser modules must not import it directly.

The main-process half of this feature lives in `main-process/sequence-library/`. It invokes process-neutral parsing and backbone-recognition entrypoints from this folder so all Sequence Viewer domain logic stays under this single feature root. IPC and app-wide storage-root integration intentionally remain in their shared infrastructure folders.

Toolbox composes the adapters from `calculations/ui/`; both the adapters and their sequence-domain logic remain owned by Sequence Viewer.
