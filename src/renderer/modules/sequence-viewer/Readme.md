# Sequence Viewer

This folder owns the renderer-side Sequence Viewer workspace and its feature-specific domain logic.

- `cloning-assembly.js` and `cloning-assembly/`: cloning route evaluation, primer design, and assembly planning.
- `protein-builder.js` and `protein-builder/`: protein construct composition, DNA generation, and plasmid assembly workflows.
- `algorithms/`: renderer-only algorithms such as AB1 trace post-processing.
- `data/`: restriction enzyme and exported standard-feature datasets.
- `runtime/`: Sequence Viewer orchestration, persistence actions, navigation, and event binding.

The main-process sequence-library adapter invokes the process-neutral backbone-recognition entrypoint from `algorithms/` so all Sequence Viewer domain logic stays together. Generic Toolbox sequence calculators remain in `src/renderer/modules/tool-box/sequence.js` because translation, oligo, extinction, and CRISPR tools also use them.
