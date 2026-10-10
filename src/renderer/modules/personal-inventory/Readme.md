# Personal Inventory Module

The **Samples** app (`sample-registry-view`): storage containers and the
samples inside them. Every sample lives in a container: deleting a sample's
slot entry or its container deletes the sample, and the notebook's Add Samples
dialog requires one.

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
- `type-fields.js`: type-specific sample fields, stored flat on `sample.details`, so a new sample type or field needs no storage or search change.
- `name-suggestions.js`: plasmid name suggestions from the sequence library (circular and linear entries, since the library has no plasmid flag).
- `chemical-structure-clipboard.js`: reads ChemDraw/MOL/SMILES or an image from the clipboard through `hikariApi.readChemicalClipboard`.
- `csv-io.js`: per-container CSV import/export keyed by well label; import upserts by sample code.

Containers are saved one file per container under `Samples/<zone>/` in the storage root (`src/main/storage/sample-containers.js`).

Maintenance notes:

- Keep state helpers free of DOM access so they stay easy to test.
- Add new rendering fragments in focused `detail-*` files before growing `index.js`.
- Keep DOM bindings in the focused event/action files rather than rebuilding a large entrypoint.
