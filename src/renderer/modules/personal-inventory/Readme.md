# Personal Inventory Module

This folder contains the split implementation of the personal inventory renderer.

- `constants.js`: shared labels, colors, section metadata, and container layout helpers.
- `state.js`: composes state-derived helper groups.
- `state-containers.js`: section, container, linked-sample, and count lookup helpers.
- `state-samples.js`: sample normalization, location, and type helpers.
- `state-sample-rendering.js`: sample legend, well metadata, and dot-fill helpers.
- `detail-rendering.js`: composes the detail-rendering fragments.
- `detail-container-rendering.js`: container detail and well-grid markup.
- `detail-well-editor.js`: multi-well side editor markup.
- `detail-single-editor.js`: single-tube side editor markup.
- `detail-structure-rendering.js`: structure action and preview markup.
- `index.js`: top-level module orchestration.
- `controller-context.js`, `section-navigation.js`, `rendering.js`: shared controller state, zone/section navigation, and the list render pass.
- `container-form.js`, `container-context-menu.js`, `container-rename-events.js`, `container-delete-events.js`, `folder-actions.js`: container create/edit, right-click menu, inline rename, delete, and container folders.
- `structure-state.js`, `structure-actions.js`, `structure-bindings.js`: chemical-structure state, actions, and bindings.
- `well-sample-events.js`, `single-sample-events.js`, `events.js`: multi-well and single-tube editor events, and the remaining top-level bindings.

Containers are saved one file per container under `Samples/<zone>/` in the storage root (`src/main/storage/sample-containers.js`).

Maintenance notes:

- Keep state helpers free of DOM access so they stay easy to test.
- Add new rendering fragments in focused `detail-*` files before growing `index.js`.
- Keep DOM bindings in the focused event/action files rather than rebuilding a large entrypoint.
