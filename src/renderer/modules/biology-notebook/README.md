# Biology Notebook

`index.js` composes the notebook view. Focused packages own the implementation:

- `entry/`: entry model, naming, list/view rendering, and saved-record construction
- `protocol/`: placeholders, snapshots, protocol text, and step rendering
- `project/`: project selection and dashboard
- `results/`: tables, linked work previews/actions, and selection insights
- `samples/`: sample normalization and linking UI
- `storage/`: imported result files and page logs
- `tools/`: calculation sidebar; its cross-feature record model lives in `renderer/lib/notebook-tool-calculations.js`

Keep new behavior in the owning package and reserve `index.js` for view-level wiring.
