# Sequence Viewer Main Process

This folder is the Node-only main-process half of the existing Sequence Viewer feature. It owns filesystem and SQLite work that cannot run in the browser renderer.

- `sequence-library/`: entry persistence, alignments, feature indexing, annotation, and recognized-backbone artifacts.
- `src/main/ipc/register-data-ipc/register-sequence-library-ipc.js`: the renderer-facing IPC adapter; it stays with the other IPC registrars.
- `src/main/storage/`: app-wide storage-root and bundle integration; it stays with shared storage infrastructure.

Renderer UI, parsing, and feature algorithms live one level above. Browser-side files must not import this `main-process/` subtree. Do not add generic sequence packages under the `src/main/` platform layer; keep new Sequence Viewer code in this single feature tree and choose the browser-safe or `main-process/` side according to its runtime.
