# Biology Notebook

`index.js` composes the notebook view. Focused packages own the implementation:

- `notebook/`: the view's controllers — experiment dialog, entry actions, saving, result files, sample links, protocol editing, page naming, project dashboard, and agent context/append
- `entry/`: entry model, naming, list/view rendering, and saved-record construction
- `agent/`: assistant notebook-draft normalization, autosave, and the saved-page append adapter (`createSavedNotebookAppend`, also used by Home)
- `protocol/`: placeholders, snapshots, protocol text, and step rendering
- `project/`: project selection, dashboard, experiment suggestions, and the project paper finder
- `results/`: linked work previews/actions, result-file attachments, and selection insights
- `spreadsheet-tables/`: the result-table grid (column definitions, context menu)
- `linked-previews.js`: builds linked assay/gel/record preview models
- `samples/`: sample normalization and linking UI
- `storage/`: imported result files and page logs
- `tools/`: calculation sidebar; its cross-feature record model lives in `renderer/lib/notebook-tool-calculations.js`

Keep new behavior in the owning package and reserve `index.js` for view-level wiring.
