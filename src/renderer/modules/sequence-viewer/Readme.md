# Sequence Viewer

This folder owns the renderer-side Sequence Viewer workspace and its feature-specific domain logic.

- `cloning-assembly.js` and `cloning-assembly/`: cloning route evaluation, primer design, and assembly planning.
- `protein-builder.js` and `protein-builder/`: protein construct composition, DNA generation, and plasmid assembly workflows.
- `algorithms/`: renderer-only algorithms such as AB1 trace post-processing.
- `calculations/`: sequence, oligo, protein, codon-usage, and CRISPR calculation cores; `calculations/ui/` holds their Toolbox-facing adapters.
- `service.js`: renderer registry handoff into Sequence Viewer.
- `data/`: restriction enzyme and exported standard-feature datasets.
- `runtime/`: Sequence Viewer orchestration, persistence actions, navigation, and event binding.
- `main-process/`: Node-only filesystem and SQLite persistence used through IPC; browser modules must not import it directly.

The main-process half of this feature lives in `main-process/sequence-library/`. It invokes process-neutral parsing and backbone-recognition entrypoints from this folder so all Sequence Viewer domain logic stays under this single feature root. IPC and app-wide storage-root integration intentionally remain in their shared infrastructure folders.

Toolbox composes the adapters from `calculations/ui/`; both the adapters and their sequence-domain logic remain owned by Sequence Viewer.
