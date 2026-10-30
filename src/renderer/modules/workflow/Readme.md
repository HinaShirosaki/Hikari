# Workflow Module

`index.js` composes the workflow workspace.

- `model.js`, `state.js`, and `execution.js`: normalized workflow/template/entry data.
- `renderer.js`, `renderer/`, and `presentation.js`: view rendering and labels.
- `graph-controller.js` and `graph/`: graph editing interactions and drawing.
- `actions.js` and `actions/`: workflow and execution mutations plus event dispatch, the template editor, step state, and the run ledger.
- `process-dialog.js`: the shared "new process" dialog used by Workflow and Notebook projects.
- `public-api.js`: the narrow surface other features import.
- `artifact-storage.js`: storage-folder paths and imported result-file persistence.
- `dom.js` and `constants.js`: DOM lookup and shared constants.
- `localization.js`, `locales/en.js`: template/process and execution UI messages, bound graph/menu/status labels, file errors, and notebook option metadata. User content and open editor elements are preserved across locale changes. `renderer.titleForBlock()` remains locale independent for saved metadata and artifact paths; UI uses `displayTitleForBlock()`. See [incremental i18n](../../../../docs/renderer/architecture/i18n.md) for coverage.

Keep filesystem path and bridge mechanics out of `actions.js`; add them to `artifact-storage.js` instead.
