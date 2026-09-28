# Toolbox

`index.js` mounts the calculator panels and `view-manager.js` switches panels, lazy-loading the colony counter (`colony-counter.js`, `colony-counter-model.js`, `colony-counter/`) on first open.

This folder owns the Tools UI:

- `molarity-ui.js`, `buffer-ui.js`, `fixed-reaction-ui.js`: bench calculators. Their math lives in `../../lib/molarity.js` and `../../lib/bench-calculations.js`.
- `peptide-tool.js`, `translation-tool.js` (DNA → protein and protein → DNA), `oligo-tool.js`, `extinction-tool.js`: sequence panels. Their math lives in `../sequence-viewer/calculations/`.
- `common.js`: shared formatting and input helpers.

`qpcr.js` (a tested `linearRegression`) and `qpcr-ui.js` hold a qPCR efficiency calculator that is not mounted: the Tools view has no qPCR panel or `qpcr-form` markup today. Adding a tool means a tile and subview in `ui/html/views/tool-box-view.html` plus an `init*Tool()` call in `index.js`.
