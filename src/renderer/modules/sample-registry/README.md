# Sample registry

The sample half of the **Samples** workspace. It shares `sample-registry-view`
with `../personal-inventory/` (the storage containers), and the shell renders
both when the view opens. `index.js` (`initSampleRegistry`) wires the pieces:

- `sample-form.js`, `location-fields.js`, `type-fields.js`: the sample form,
  storage location, and type-specific fields. Type-specific values are stored
  flat on `record.details`, so a new sample type or field needs no storage or
  search change (the agent's inventory lookup searches `details` as a whole).
- `sample-list.js`: **Registered Samples** list and search.
- `sample-utils.js`: state guards and default sample codes.
- `inventory-links.js`: container and well placement options from Personal
  Inventory.
- `name-suggestions.js`: plasmid name suggestions from the sequence library
  (circular and linear entries, since the library has no plasmid flag).
- `cell-passage.js`: last-passage date and interval for cell lines, stored as
  `sample.cellPassage` (the Home **Cell passage** widget reads it).
- `compound-model.js`, `compound-dialog.js`, `compound-actions.js`,
  `compound-preview.js`, `chemical-structure-clipboard.js`: chemical samples'
  structure data, pasted from ChemDraw/MOL/SMILES or an image through
  `hikariApi.readChemicalClipboard`, with a rendered preview.
- `csv-io.js`: CSV import/export with container placement, so a whole box
  round-trips.
- `notebook-workflow.js`, `notebook-capture.js`, `notebook-capture-record.js`:
  capturing a sample from, or into, the open notebook entry.
- `events.js`, `dom.js`: event bindings and DOM lookup.
- `public-api.js`: the narrow surface other features import (Personal
  Inventory's structure actions and the Notebook quick-sample controller).

Sample type names come from **Settings > Locations & samples**
(`settings.sampleTypeLabels`, including custom types). Samples are saved with
their containers under `Samples/<zone>/` in the storage root
(`src/main/storage/sample-containers.js`); samples in no container go to
`Samples/unplaced.json`.
