# Settings Module

`index.js` coordinates the Settings view and retains the public `initSettings()` entry.

- `dom.js`: typed DOM lookup bundle.
- `form-presentation.js`: keeps each form's unsaved draft across navigation and background catalog refreshes, and drives the save/discard bar.
- `codex-account.js`: the **Codex** panel's account status polling, sign-in/sign-out, CLI install card, and the **Connect Codex Desktop** setup prompt.
- `codex-usage.js`: account usage percentages and reset times, refresh state, and invalidation of pending usage reads when signing out.
- `llm-model-catalog.js`: provider/Codex model and reasoning-option normalization.
- `mcp-tools-controller.js`: the **Tool access** panel (per-tool on/off switches).
- `external-skills-controller.js`: external skill catalog loading, rendering, and enable/disable state.
- `plugins-controller.js`: the plugin list under **Skills & plugins** (add, enable/disable, remove, reload).
- `sample-inventory-controller.js`: location and sample-type vocabulary settings (**Locations & samples**), including location migration and custom sample types.
- `preferred-journals.js`: the preferred-journal list (**Papers**).
- `notebook-pdf-controller.js`: notebook PDF export defaults (**Notebook PDF**).
- `update-controller.js`: the **Updates** panel: Check for Updates / Install Update, rendering the main-process updater's status.
- `html.js`: local markup escaping.

Panels are grouped in the rail as Workspace (Appearance, Startup, Storage & data, Updates), Lab preferences (Locations & samples, Papers, Notebook PDF), and Agent & extensions (Codex, Tool access, Skills & plugins).

Keep new settings families in focused controllers rather than adding another long section to `index.js`.
