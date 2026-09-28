# Data IPC Package

`../register-data-ipc.js` owns storage and import endpoints. This folder holds
its filesystem helpers and endpoint groups large enough to maintain independently.

- `register-sequence-library-ipc.js`: Sequence Viewer library CRUD, feature search, annotation, and backbone recognition IPC only. Domain and persistence logic stays in `src/renderer/modules/sequence-viewer/main-process/sequence-library/`.
