# Personal Inventory Module

This folder contains the split implementation of the personal inventory renderer.

- `constants.js`: shared labels, colors, section metadata, and container layout helpers.
- `state.js`: state-derived helpers for samples, locations, counts, and well metadata.
- `detail-rendering.js`: markup generation for container details, wells, and editors.
- `index.js`: DOM wiring and top-level module orchestration.

Maintenance notes:

- Keep state helpers free of DOM access so they stay easy to test.
- Add new rendering fragments in `detail-rendering.js` before growing `index.js`.
- If event handling expands again, split DOM bindings into a dedicated `events.js`.
