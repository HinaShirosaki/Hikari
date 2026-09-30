# Data IPC Package

`../register-data-ipc.js` owns storage and import endpoints. This folder holds
its filesystem helpers and endpoint groups large enough to maintain independently.

- `register-sequence-library-ipc.js`: Sequence Viewer library CRUD, folders, feature search, annotation, and backbone recognition IPC only. Domain and persistence logic stays in `src/renderer/modules/sequence-viewer/main-process/sequence-library/`.
- `storage-files.js`: the filesystem work behind the storage handlers — storage-root confinement, the last-root pointer, imported and moved files, JSON writes, and the paper PDF → Markdown transform.
