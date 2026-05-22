# Main Sequence Adapters

This folder is intentionally thin. It preserves the existing main-process require paths while keeping heavy Sequence Viewer algorithms and sequence-library storage implementation out of this adapter layer.

- `circular-plasmid-annotation.js`: compatibility export for the Sequence Viewer circular plasmid annotation algorithm.
- `sequence-backbone-recognition.js`: compatibility export for the Sequence Viewer backbone-recognition algorithm.
- `sequence-library.js`: compatibility export for the main-process Sequence Viewer storage library.

New algorithm code should live under `src/renderer/modules/sequence-viewer/algorithms/`. New storage/database code should live under `src/main/helpers/main/sequence-library/`.
