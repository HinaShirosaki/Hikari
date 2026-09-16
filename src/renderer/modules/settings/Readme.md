# Settings Module

`index.js` coordinates the Settings view and retains the public `initSettings()` entry.

- `dom.js`: typed DOM lookup bundle.
- `external-skills-controller.js`: external skill catalog loading, rendering, and enable/disable state.
- `llm-model-catalog.js`: provider/Codex model and reasoning-option normalization.
- `sample-inventory-controller.js`: location and sample-type vocabulary settings, including location migration.
- `html.js`: local markup escaping.

Keep new settings families in focused controllers rather than adding another long section to `index.js`.
