# Workflow Module

`index.js` composes the workflow workspace.

- `model.js`, `state.js`, and `execution.js`: normalized workflow/template/entry data.
- `renderer.js` and `presentation.js`: view rendering and labels.
- `graph-controller.js`: graph editing interactions.
- `actions.js`: workflow and execution mutations plus event dispatch.
- `artifact-storage.js`: storage-folder paths and imported result-file persistence.
- `dom.js` and `constants.js`: DOM lookup and shared constants.

Keep filesystem path and bridge mechanics out of `actions.js`; add them to `artifact-storage.js` instead.
