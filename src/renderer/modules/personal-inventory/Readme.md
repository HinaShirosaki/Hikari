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

Maintenance notes:

- Keep state helpers free of DOM access so they stay easy to test.
- Add new rendering fragments in focused `detail-*` files before growing `index.js`.
- Keep DOM bindings in the focused event/action files rather than rebuilding a large entrypoint.
