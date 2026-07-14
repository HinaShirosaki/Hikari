# Data IPC Package

`../register-data-ipc.js` owns storage, import, and plugin endpoints. This folder holds endpoint groups large enough to maintain independently.

- `register-sequence-library-ipc.js`: Sequence Viewer library CRUD, feature search, annotation, and backbone recognition IPC only. Domain and persistence logic stays in `src/renderer/modules/sequence-viewer/main-process/sequence-library/`.
