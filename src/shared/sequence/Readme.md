# Shared Sequence Algorithms

This folder owns process-neutral sequence analysis used by both Electron main and renderer code.

- `circular-plasmid-annotation.js` and `circular-plasmid-annotation/`: circular sequence matching with an optional worker-thread path.
- `sequence-backbone-recognition.js` and `sequence-backbone-recognition/`: backbone and insertion recognition against the stored sequence library.
- `orf-features.js`: process-neutral ORF feature detection.
- `restriction-features.js`: process-neutral commercial restriction-site detection.
- `sequence-utils.js`: small DNA and topology helpers shared by those algorithms.

Filesystem and SQLite orchestration remain in `src/main/helpers/main/sequence-library/`. Renderer presentation and interaction remain in `src/renderer/modules/sequence-viewer/`.
