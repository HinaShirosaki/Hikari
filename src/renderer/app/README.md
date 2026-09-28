# Renderer app shell

Shell code that is not a feature: navigation, topbar search, storage-root
setup and import, the plugin host, and a few global UI behaviors. The renderer
core (`../core/start-hikari-core.js`) creates and wires these. Feature modules
do not import from here (Settings' use of `appearance.js` is the one
exception); they get what they need through their manifest options.

## Navigation and search

- `navigation-shell.js`: `showView`, startup-view resolution and last-view
  memory, page title/subtitle, and body classes per view.
  - `navigation-shell/app-dock.js`: dock buttons in registry order, folding what
    does not fit (and every plugin) into **More**.
  - `navigation-shell/agent-rail.js`: the agent chat side rail for views whose
    registry entry sets `agentChatRail` (open/close/state events).
  - `navigation-shell/search-suggestions.js`: the topbar suggestion dropdown.
- `topbar-search.js` + `topbar-search/candidates.js`, `topbar-search/scoring.js`:
  scoped commands (`samples colony-7`), view aliases (`dna`, `papers`), and
  global matching over records.
- `topbar-open-handlers.js`: jump straight to a chosen record (chemical, sample,
  plate, project, protocol, paper, workflow, notebook page, container).

## Storage root

- `storage-setup.js`: the first-launch **Choose Folder** page, also shown when
  the saved root cannot be opened.
- `storage-import.js`: hydrates renderer state from the storage root through
  `hikariApi.importStorageRoot`, surfaces `alerts` (such as an unreadable
  chemicals index) as notices, and, when a root is opened from the setup page,
  runs the save that writes the module folders.
- `storage-import-merge.js`: merges imported records into the live state.

## Plugin host

- `plugin-loader.js`: turns each enabled plugin in `state.settings.plugins`
  into a `.view` section with a sandboxed iframe and an `APP_REGISTRY` entry.
  Runs before the navigation shell, which snapshots both.
- `plugin-bridge.js` + `plugin-bridge/verbs.js`, `plugin-bridge/helpers.js`:
  the permission-gated `postMessage` API. Every verb names the permission it
  needs; frames are identified by `contentWindow`, never by message content.
- `plugin-origin.js`: accepts only the private loopback origin main assigned.
- `plugin-services.js`: hidden service-plugin frames and the capability
  registry (file converters) other features query.

See [docs/plugins/](../../../docs/plugins/README.md).

## Global behavior

- `shared-left-rail.js`: resizable, collapsible left rails whose width is shared
  across views (and reported to plugin frames).
- `appearance.js`: applies theme mode and font size.
- `error-reporting.js`: forwards uncaught renderer errors to main's
  `Logs/errors.log`.
- `icon-button-captions.js`: hover captions for icon-only buttons.
- `dialog-layout.js`: keeps dialogs clear of the topbar.

The boot order is in
[docs/renderer/architecture/boot-and-shell.md](../../../docs/renderer/architecture/boot-and-shell.md).
