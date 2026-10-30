# Toolbox

`index.js` mounts the calculator panels and `view-manager.js` switches panels, lazy-loading the colony counter (`colony-counter.js`, `colony-counter-model.js`, `colony-counter/`) on first open.

This folder owns the Tools UI:

- `molarity-ui.js`, `buffer-ui.js`, `fixed-reaction-ui.js`: bench calculators. Their math lives in `../../lib/molarity.js` and `../../lib/bench-calculations.js`.
- `peptide-tool.js`, `translation-tool.js` (DNA → protein and protein → DNA), `oligo-tool.js`, `extinction-tool.js`: sequence panels. Their math lives in `../sequence-viewer/calculations/`.
- `common.js`: shared formatting and input helpers.
- `localization.js`, `locales/en.js`: Tools UI messages, bound result labels, dilution instructions, and Buffer/Reaction validation. Numbered row labels retain their index when cloned or given computed placeholders. Calculation `displayMessage` descriptors are additive; legacy summaries and formulas stay canonical. See [incremental i18n](../../../../docs/renderer/architecture/i18n.md) for current coverage. Colony Counter controls, status and count/mask summaries also use this catalog; `colony-counter/summary.js` keeps that presentation separate from image/marker/model state. Local errors keep canonical English messages and additive UI metadata; backend errors remain literal.

`qpcr.js` (a tested `linearRegression`) and `qpcr-ui.js` hold a qPCR efficiency calculator that is not mounted: the Tools view has no qPCR panel or `qpcr-form` markup today. Adding a tool means a tile and subview in `ui/html/views/tool-box-view.html` plus an `init*Tool()` call in `index.js`. Tool plugins (`"tool": true`, see `docs/plugins/plugin-system.md` §1.7) get theirs from `src/renderer/app/plugin-loader.js`, which appends them before this module initializes so `view-manager.js` binds them like the built-in tiles.
