# Hikari Plugin System

Hikari supports user-installed plugins. A plugin is a plain folder of web files
(HTML + CSS + JS). The user adds the folder in **Settings → Plugins**, and on
the next app reload the plugin appears as a regular app in navigation, rendered
inside its own sandboxed iframe.

This document covers everything: what a plugin is, how to write one, how users
install and manage plugins, how the app boots them internally, the security
model, and the current limitations.

---

## 1. What a plugin is

A plugin is a folder on disk with this shape:

```
my-plugin/
├── index.html      (required — the entry page)
├── plugin.json     (optional — name and description metadata)
├── style.css       (optional — referenced from index.html)
├── main.js         (optional — referenced from index.html)
└── ...             (any other assets: images, fonts, subfolders)
```

Only `index.html` is required. Everything else is up to the plugin author —
the entry page is loaded like a normal webpage, so any relative reference
(`<link href="./style.css">`, `<script src="./main.js">`, images, subfolders)
resolves against the plugin folder. There is no build step, no framework
requirement, and no special API to learn: **if it works as a static webpage,
it works as a plugin.**

### 1.1 `plugin.json` schema

```json
{
  "name": "Hello World",
  "description": "Short one-line description shown in Settings and navigation."
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | no | Display name in navigation and Settings. Defaults to the folder name. Max 120 chars. |
| `description` | string | no | Shown in Settings and as the view subtitle. Max 400 chars. |

Unknown fields are ignored. A missing `plugin.json` is fine; a `plugin.json`
that exists but is not valid JSON makes the folder rejected at install time
with a clear error.

The plugin **id** is derived from the name (lower-cased, non-alphanumeric runs
collapsed to `-`), e.g. `"Hello World"` → `hello-world`. Two installed plugins
cannot share an id.

### 1.2 Example plugin

A complete working example ships in the repo at
[`examples/plugins/hello-world/`](../../examples/plugins/hello-world/):
an `index.html` that pulls in its own `style.css` and `main.js` with a click
counter. Point **Settings → Plugins → Add Plugin Folder** at that folder to
try the whole flow end to end.

---

## 2. Installing and managing plugins (user flow)

1. Open **Settings** (gear app) → **Plugins** in the left rail.
2. Click **Add Plugin Folder** and pick the plugin folder in the directory
   dialog.
3. The app validates the folder (must contain `index.html`; `plugin.json`, if
   present, must be valid JSON). Invalid folders are rejected with the reason
   shown in the status line.
4. The plugin is saved as *enabled*. Click **Reload App** (or restart) to boot
   it — the status line reminds you whenever a change needs a reload.
5. After reload, the plugin appears in the app dock / "More" menu with a plug
   icon, and participates in topbar search and the startup-view logic like any
   built-in app.

Each installed plugin row in Settings shows its name, description, and folder
path, plus:

- an **On/Off toggle** — a disabled plugin stays installed but is not booted;
- a **Remove** button — forgets the plugin. The folder on disk is never
  touched; removing a plugin only deletes its settings entry.

All plugin management changes (add, toggle, remove) take effect on the next
reload, because navigation and views are constructed once at boot (see §4).

---

## 3. What gets stored

Installed plugins live in renderer state under `state.settings.plugins`, an
array of records:

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "description": "Minimal example plugin ...",
  "path": "/Users/me/plugins/hello-world",
  "entryUrl": "file:///Users/me/plugins/hello-world/index.html",
  "enabled": true
}
```

- `entryUrl` is computed once at install time (main process,
  `url.pathToFileURL`) so the renderer never does path→URL conversion and
  Windows paths are handled correctly.
- The array survives reloads: `normalizePluginEntries()` in
  [`state-normalizer.js`](../../src/renderer/modules/app-state/state-normalizer.js)
  whitelists it (entries without an `id`/`entryUrl`, or with duplicate ids,
  are dropped; `enabled` defaults to `true`).
- `name`/`description` are snapshots of `plugin.json` at install time. If the
  plugin author changes the manifest, remove and re-add the plugin to refresh
  them. Changes to the plugin's HTML/CSS/JS content need **no** re-add — the
  files are read live from disk on every boot.

---

## 4. How the app boots a plugin (internals)

### 4.1 Boot sequence

`startHikariCore()` in
[`start-hikari-core.js`](../../src/renderer/core/start-hikari-core.js) calls
`installPlugins()` immediately after `loadState()` — crucially **before**
`createNavigationShell()` runs, because the shell snapshots both the
`.view` DOM sections and `APP_REGISTRY` at construction time.

For each entry in `state.settings.plugins` with `enabled !== false`,
[`plugin-loader.js`](../../src/renderer/app/plugin-loader.js):

1. **Creates a view section** appended to `.workspace-main`:

   ```html
   <section id="plugin-<id>-view" class="view plugin-view">
     <iframe class="plugin-frame" src="<entryUrl>"
             sandbox="allow-scripts allow-forms allow-modals allow-popups">
   </section>
   ```

   The iframe fills the workspace (`.plugin-view.is-active` is a flex
   container; rules live next to the `.view` rules in
   `ui/css/base/core.css`).

2. **Pushes an app entry into `APP_REGISTRY`** (the same mutable array the
   generated registry exports) with `id: plugin-<id>`,
   `viewId: plugin-<id>-view`, the plugin's name/description, a plug icon,
   and `placement: 'more'`.

Because plugin apps are ordinary registry entries created before the shell
boots, everything downstream works with zero plugin-specific code: dock/more
navigation, `showView()` toggling, topbar search aliases, valid-startup-view
checks, and the active-view title/subtitle in the topbar.

This is also why changes need a reload: the shell does not support adding or
removing apps after construction, and a reload is a cheap, reliable way to
re-run the whole boot path.

### 4.2 Install-time validation (main process)

The renderer cannot touch the filesystem, so folder validation is an IPC call:

- Channel: `plugins:inspect-folder`
  (`PLUGINS.INSPECT_FOLDER` in
  [`src/shared/ipc/channels.js`](../../src/shared/ipc/channels.js))
- Handler: registered in
  [`register-data-ipc.js`](../../src/main/ipc/register-data-ipc.js), thin
  wrapper around
  [`inspect-plugin-folder.js`](../../src/main/helpers/main/inspect-plugin-folder.js)
- Preload: `window.hikariApi.inspectPluginFolder(path)` in
  [`system-api.js`](../../src/main/preload/api/system-api.js)

`inspectPluginFolder({ fs, folderPath })` checks:

| Check | Failure result |
| --- | --- |
| path is a non-empty absolute path | `Plugin folder path must be an absolute path.` |
| `index.html` exists and is a file | `Plugin folder does not contain index.html.` |
| `plugin.json`, if present, parses as JSON | `plugin.json is not valid JSON.` |
| an id can be derived from name/folder | `Could not derive a plugin id from the folder name.` |

On success it returns `{ ok: true, id, name, description, path, entryUrl }` —
exactly the record the Settings controller stores (plus `enabled: true`).

The directory picker reuses the existing `storage:pick-directory` dialog
(`window.hikariApi.pickStorageDirectory`).

### 4.3 Settings panel

- Markup: `data-settings-panel="plugins"` section in
  [`ui/html/views/setting-view.html`](../../ui/html/views/setting-view.html)
  (remember: `index.html` is generated — edit the fragment and run
  `npm run build:ui`).
- Elements: `setting-plugins-add-btn`, `setting-plugins-reload-btn`,
  `setting-plugins-status`, `setting-plugins-list`, resolved in
  [`settings/dom.js`](../../src/renderer/modules/settings/dom.js).
- Logic:
  [`settings/plugins-controller.js`](../../src/renderer/modules/settings/plugins-controller.js),
  wired up in [`settings/index.js`](../../src/renderer/modules/settings/index.js)
  following the same controller pattern as external skills.

---

## 5. Security model

Plugins are untrusted third-party code, so they run with the least privilege
the platform offers:

- **Sandboxed iframe.** The frame has
  `sandbox="allow-scripts allow-forms allow-modals allow-popups"` and
  deliberately **not** `allow-same-origin`, so the plugin executes as an
  opaque origin: it cannot reach the host DOM, the host's `localStorage`
  (where app state lives), or cookies.
- **No Node, no bridge.** The renderer already runs with
  `contextIsolation: true` and `nodeIntegration: false`, and Electron preload
  scripts do not run in subframes — so plugins never see `window.hikariApi`
  or any Node capability. Worst case, a malicious plugin is an ordinary
  webpage in a box.
- **Read-only integration.** The host reads plugin files; plugins get no
  handle back into the host. All plugin state changes go through the Settings
  UI in the host page.

What the sandbox does *not* prevent: a plugin page can still make outbound
network requests (like any webpage) and can use `allow-popups` to open
windows. Only install plugin folders you trust.

---

## 6. Limitations and future extensions

Deliberate v1 simplifications:

- **Reload to apply.** Add/enable/disable/remove all require an app reload
  (one click in the same panel). Live mount/unmount would require the
  navigation shell to support dynamic app registration.
- **No host API for plugins.** Plugins cannot read lab data or call app
  functions. The natural upgrade path is a `postMessage` bridge between the
  host and the plugin frame with an explicit, capability-scoped message
  schema — add it when a real plugin needs it.
- **Metadata is snapshotted.** `plugin.json` changes require remove + re-add
  (content changes do not).
- **`plugin.json` is minimal.** No versioning, icons, permissions, or update
  channels. Fields can be added later without breaking existing plugins,
  since unknown fields are ignored and every current field is optional.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Plugin folder does not contain index.html." | The entry file must be named exactly `index.html` at the top of the selected folder. |
| "plugin.json is not valid JSON." | Fix the manifest syntax (or delete the file — it's optional). |
| Plugin added but not in navigation | Reload the app (Settings → Plugins → Reload App). |
| Blank plugin view | Open DevTools and check the console; the plugin page failed like any webpage would (bad script path, JS error). Paths inside the plugin must be relative. |
| Plugin can't save data via `localStorage` | Expected: the sandbox denies storage to opaque origins. Keep state in memory, or wait for the host bridge (§6). |
| A plugin named X "is already installed" | Ids derive from names. Rename one plugin in its `plugin.json`, or remove the old entry first. |

---

## 8. Extending beyond iframe plugins

Iframe plugins are deliberately isolated: fixed plug icon, "More"-menu
placement, no host UI, no agent integration. When an extension needs more —
a dock icon, the shared left-rail layout, agent MCP tools, or its own skill —
it graduates from a plugin folder to a **first-class module** wired into the
codebase. This section gives the instructions for each of those four
integration points. (The general module recipe lives in
[docs/module-development/](../module-development/README.md).)

### 8.1 Dock bar icon and placement

Built-in apps get their dock icon and position from
[`ui/config/app-registry.json`](../../ui/config/app-registry.json):

1. **Draw the icon.** Save an SVG at `assets/icons/<my-feature>.svg`. Match
   the house style: `viewBox="0 0 24 24"`, `stroke="currentColor"`,
   `fill="none"`, stroke width ≈ 1.75, round caps/joins. `currentColor` is
   required so the icon follows active/hover tinting.
2. **Reference it** in your app entry: `"icon": "my-feature.svg"`. The build
   (`npm run build:ui`) reads the file and inlines it as `iconMarkup` in
   `app-registry.generated.js` — never edit the generated file.
3. **Choose placement.** `"placement": "dock"` plus an entry in the
   `dockOrder` array (same file, order = dock position) pins the app to the
   dock bar. Apps not in `dockOrder` land in the "More" menu. The dock is
   responsive: when the window is narrow, trailing dock apps overflow into
   "More" automatically ([`navigation-shell.js`](../../src/renderer/app/navigation-shell.js)
   `getDockCapacity()`), so dock placement is a preference, not a guarantee.

Iframe plugins currently always use the built-in plug icon and "More"
placement (`PLUGIN_ICON_MARKUP` in
[`plugin-loader.js`](../../src/renderer/app/plugin-loader.js)). Supporting a
custom icon via a `plugin.json` field is a straightforward future extension:
have `inspectPluginFolder` read and sanitize an SVG, store it on the settings
record, and use it instead of the constant.

### 8.2 Using the shared left rail

Most built-in workspaces use the universal two-pane layout from
[`ui/css/overrides/left-rail-template.css`](../../ui/css/overrides/left-rail-template.css).
Skeleton for a view fragment:

```html
<div class="my-feature-layout left-rail-template">
  <aside class="my-feature-rail app-left-rail left-rail-template__rail"
         data-sync-left-rail
         aria-label="My feature navigation">
    <!-- rail header, filters, list -->
  </aside>
  <div class="my-feature-content left-rail-template__main">
    <!-- main content -->
  </div>
</div>
```

What each piece buys you:

- `left-rail-template` / `__rail` / `__main` — the grid layout, borders, and
  scrolling behavior shared by all rail views.
- `data-sync-left-rail` on the `<aside>` — opts into the **shared, draggable,
  persisted rail width** driven by
  [`src/renderer/shared-left-rail.js`](../../src/renderer/shared-left-rail.js)
  (CSS variables `--shared-left-rail-width/min/max`). Every participating
  view resizes together.
- The navigation shell toggles `body.has-shared-left-rail-view` when the
  active view shows a synced rail, which aligns the surrounding shell chrome.

Full details and CSS-layer ordering: [module-development/02-html-and-css.md](../module-development/02-html-and-css.md).
Inside an iframe plugin none of this applies — the plugin page draws its own
rail with its own CSS if it wants one.

### 8.3 Registering MCP tools

Agent-facing tools live in the provider-neutral MCP contract at
`src/main/helpers/agent/mcp-contract/`. To register a new direct tool:

1. **Create the tool module**
   `src/main/helpers/agent/mcp-contract/direct-tools/<my-tool>.js`, modeled
   on [`ask-user.js`](../../src/main/helpers/agent/mcp-contract/direct-tools/ask-user.js).
   Export a frozen definition and an async handler:

   ```js
   const MY_TOOL_MCP_TOOL = Object.freeze({
     name: 'my_tool',                       // snake_case, stable
     description: 'One sentence on when the agent should call this.',
     annotations: buildReadOnlyToolAnnotations('My tool'), // or buildWriteToolAnnotations
     inputSchema: { type: 'object', additionalProperties: false, /* ... */ }
   });

   async function callMyTool(args, context, deps) {
     // validate args, do the work, return a structured result
   }
   ```

2. **Register it** in
   [`direct-tools/index.js`](../../src/main/helpers/agent/mcp-contract/direct-tools/index.js):
   import the pair and append `{ definition: MY_TOOL_MCP_TOOL, handler: callMyTool }`
   to `DIRECT_MCP_TOOLS`. Everything downstream (the stdio MCP server, the
   tool router, definition listing) picks it up from that array.

3. **Expose it to Codex** in
   [`mcp-contract/instructions.js`](../../src/main/helpers/agent/mcp-contract/instructions.js):
   add `'my_tool'` to `HIKARI_MCP_TOOL_NAMES` (this list becomes
   `enabled_tools` in the Codex `config.toml` block written by
   `codex-agent/runtime-files.js`) and add a
   `` `${toolName('my_tool')}`: ... `` bullet plus any tool-use rule to
   `buildHikariAgentMcpInstructionBodyLines()` so the agent knows when to
   call it. Codex sees the tool as `mcp__hikari__my_tool`.

4. **Keep the contract doc in sync** —
   [`docs/agent/mcp-contract/mcp-contract.md`](../agent/mcp-contract/mcp-contract.md)
   is the exported contract description.

Two shortcuts worth knowing: tools already declared in the app tool catalog
can be bridged through
[`generic-app-tool.js`](../../src/main/helpers/agent/mcp-contract/direct-tools/generic-app-tool.js)
instead of hand-writing a definition; and a module can own a whole tool
*group* in its own tree and spread it into the registry — the papers module
does this with `PAPER_INTAKE_DIRECT_MCP_TOOLS` from
`src/main/papers/store/intake/mcp-tools.js`, which is the pattern to copy for
module-owned tools.

### 8.4 Module-owned skills

A skill is a `SKILL.md` (YAML frontmatter + markdown body) that teaches the
agent when and how to use a capability. There are two kinds:

**Official (module-owned) skills** ship with the app and travel with the MCP
tools they describe. They are defined in code, in `OFFICIAL_MCP_SKILLS` in
[`official-mcp-skills.js`](../../src/main/helpers/agent/codex-agent/official-mcp-skills.js).
To add one for your module:

1. Append an entry to `OFFICIAL_MCP_SKILLS` with a unique `id`, a
   `directory` (convention: `hikari-<name>`), and `content` built with
   `buildSkillMarkdown({ id, name, description, body })`. Reference your MCP
   tools by their prefixed names via `buildHikariCodexMcpToolName('my_tool')`
   so the skill matches what the agent actually sees.
2. That's it — at agent startup (and on storage-root sync) the app releases
   every official skill into `<workspace>/.agents/skills/<directory>/SKILL.md`
   (`releaseOfficialMcpSkillsForWorkspace`). The release is idempotent and
   safe: each generated file carries a `HIKARI_OFFICIAL_MCP_SKILL:<id>`
   marker, and a file *without* the marker (i.e. hand-edited by the user) is
   preserved, never overwritten.

The `paper-intake` skill is the reference example: the papers module owns
both the MCP tools (§8.3) and the skill that instructs the agent to run them
after a PDF is ingested.

**External skills** are user-provided, not module-owned: any
`<folder>/SKILL.md` under `~/.hikari/skills`, `~/.agents/skills`,
`<workspace>/.agents/skills`, or `<workspace>/skills` is discovered at
runtime by
[`agent-skill-runtime.js`](../../src/main/helpers/agent/skills/agent-skill-runtime.js)
and toggled per-skill in **Settings → External Skills**. Frontmatter fields
(all optional except `name`/`description`):

| Field | Meaning |
| --- | --- |
| `name`, `description` | Identity and the trigger text shown to the agent. |
| `user-invocable` | Expose as a `/command` (default `true`). |
| `disable-model-invocation` | Command-only; hidden from agent prompts. |
| `command-dispatch: tool` + `command-tool` | Make the command call a tool directly instead of prompting. |
| `command-arg-mode` | How command arguments are passed (default `raw`). |
| `metadata: {"openclaw": {"requires": {...}, "os": [...], "always": true}}` | Eligibility gates: required binaries/env/config, OS filter, always-on. |

See [`skills/command-line/SKILL.md`](../../skills/command-line/SKILL.md) for
a complete working example.

Rule of thumb: if the skill documents a capability your module ships, put it
in `OFFICIAL_MCP_SKILLS` so it deploys, updates, and stays consistent with
the code; use external skill folders only for user- or site-specific
additions.

---

## 9. Testing

`npm test` includes a plugin-system test covering `inspectPluginFolder`
(missing entry file, relative paths, manifest parsing, id/URL derivation) —
see `plugin system: inspect-plugin-folder ...` in [`test.js`](../../test.js).
For a manual end-to-end check, install
[`examples/plugins/hello-world/`](../../examples/plugins/hello-world/) and
click the counter button after a reload.
