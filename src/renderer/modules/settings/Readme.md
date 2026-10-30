# Settings Module

`index.js` coordinates the Settings view and retains the public `initSettings()` entry.

- `dom.js`: typed DOM lookup bundle.
- `form-presentation.js`: keeps each form's unsaved draft across navigation and background catalog refreshes, and drives the save/discard bar.
- `localization.js`, `locales/en.js`: English messages and safe bindings for static panel copy, update states, journals, sample-location/type controls, and plugin management/preferences. Shared save/discard/status text lives in `renderer/lib/i18n/en.js`. Account/usage, file-access, and tool/skill runtime copy remain later batches. See [incremental i18n](../../../../docs/renderer/architecture/i18n.md).
- `codex-account.js`: the **Codex** panel's account status polling, sign-in/sign-out, CLI install card, and the **Connect Codex Desktop** setup prompt.
- `codex-usage.js`: account usage percentages and reset times, refresh state, and invalidation of pending usage reads when signing out.
- `llm-model-catalog.js`: provider/Codex model and reasoning-option normalization.
- `mcp-tools-controller.js`: the **Tool access** panel (per-tool on/off switches).
- `external-skills-controller.js`: the **External skills** panel's catalog loading, rendering, and enable/disable state.
- `plugins-controller.js`: the **Plugins** panel (install from GitHub or a local folder, enable/disable, remove, reload).
- `plugin-preferences-controller.js`: manifest-declared plugin preference forms, validation, save/discard/reset, and live synchronization through the plugin `settings` API. See [plugin settings](../../../../docs/plugins/plugin-settings.md).
- `sample-inventory-controller.js`: location and sample-type vocabulary settings (**Locations & samples**), including location migration and custom sample types.
- `preferred-journals.js`: the preferred-journal list (**Papers**).
- `notebook-pdf-controller.js`: notebook PDF export defaults (**Notebook PDF**).
- `update-controller.js`: the **Updates** panel: Check for Updates / Install Update, rendering the main-process updater's status.
- `html.js`: local markup escaping.

Panels are grouped in the rail as Workspace (Appearance, Startup, Storage & data, Updates), Lab preferences (Locations & samples, Papers, Notebook PDF), and Agent & extensions (Codex, Tool access, External skills, Plugins).

Keep new settings families in focused controllers rather than adding another long section to `index.js`.
