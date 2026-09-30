# Sequence Viewer Algorithms

This folder owns Sequence Viewer algorithms, including AB1 trace post-processing, ORF and restriction analysis, circular plasmid annotation, and backbone recognition.

- `circular-plasmid-annotation.js` + `circular-plasmid-annotation/`: feature annotation for circular records.
- `sequence-backbone-recognition.js` + `sequence-backbone-recognition/`: backbone recognition against the stored library.
- `orf-features.js`, `restriction-features.js`: ORF and restriction-site features.
- `ab1-trace-postprocess.js`: AB1 trace post-processing (renderer only).
- `sequence-utils.js`, `positive-modulo.cjs`: shared helpers.

These files are process-neutral except the AB1 post-processing. The main-process sequence library imports the backbone-recognition entrypoint (which pulls in the annotation, ORF, and restriction helpers) and `positive-modulo.cjs`, because it needs direct access to Sequence Viewer storage.
