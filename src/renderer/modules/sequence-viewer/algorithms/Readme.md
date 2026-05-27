# Sequence Viewer Algorithms

This folder owns algorithmic helpers that support Sequence Viewer workflows but may still be invoked from the main process through stable adapter paths.

- `circular-plasmid-annotation.js`: public shim for the split circular annotation implementation in `circular-plasmid-annotation/`.
- `sequence-backbone-recognition.js`: public shim for the split backbone recognition implementation in `sequence-backbone-recognition/`.

Keep IPC, SQLite, and filesystem storage code out of this folder. Main-process adapters should pass data in and consume plain result objects.
