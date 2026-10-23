# Hikari Plugin System

A plugin is a folder of web files that Hikari boots as a first-class app: it
gets a navigation entry, its own workspace view, and — if its manifest asks for
it — a narrow set of permission-gated host capabilities. A **tool plugin** is
booted as one more tool in **Tools** instead (§1.7).

New plugin author? Start with the copyable
[**quickstart.md**](quickstart.md). §1–3 and §6–7 of this page are the complete
folder contract for plugin authors; §4–5 and §8–9 are host internals for Hikari
contributors. The [plugin docs index](README.md) lists the rest.

---

## 1. The folder contract

Hikari **refuses to install** a folder that does not match one of the supported
shapes below. The rules are strict on purpose: identity is declared, never
inferred, so a plugin keeps its id (and therefore its stored settings) when its
title changes.

### 1.0 Four kinds of plugin

The first three are **view** plugins — they open a workspace. The fourth is a
**service** — no view, it registers a capability instead. All four install and
are managed identically in Settings; the kind is a manifest fact, not a
different install flow.

|  | **Local** | **Served** | **Remote** | **Service** |
| --- | --- | --- | --- | --- |
| Ships | `index.html` + assets | `index.html` + assets | nothing but `plugin.json` | `index.html` + assets |
| Manifest | no flag | `serve: true` | `embed: "https://…"` | `service: {…}` |
| Loaded from | `http://127.0.0.1:<port>` | `http://127.0.0.1:<port>` | the remote URL | `http://127.0.0.1:<port>` (hidden) |
| Runs as | its own loopback origin | its own loopback origin | the remote site's origin | its own loopback origin |
| Sandbox | `allow-scripts allow-forms allow-modals allow-popups allow-same-origin` | same as local | same as local | same as local |
| `localStorage` / `IndexedDB` | works | works | works | works |
| Scripts | classic or module (§5.4) | classic or module | (remote's own) | classic or module |
| Has a view | yes (whole pane) | yes | yes | **no** — headless |
| Host API | may hold permissions | may hold permissions | **never** | may hold permissions |
| Example | [`hello-world`](../../examples/plugins/hello-world/), [`notebook-results`](../../examples/plugins/notebook-results/) | [`src/plugins/gel`](../../src/plugins/gel/) (bundled), [`plugins/scientific-illustration`](../../plugins/scientific-illustration/) | — | none in the repo; see [service-plugins.md](service-plugins.md) |

**Which to write:**

- **Local** by default. Hikari automatically serves the installed folder on
  its own loopback origin so scripts and styles load in Electron.
- **Served** remains supported for existing manifests. `serve: true` now uses
  the same delivery and sandbox as a local plugin without the flag.
- **Remote** only to embed an existing web app you cannot bundle. It buys
  nothing except someone else's hosting, and costs you the host API entirely.
- **Service** to extend a built-in feature rather than add a workspace — today,
  teaching a feature to open a file format via conversion. Full details in
  [service-plugins.md](service-plugins.md).

A local or served plugin can also be a **tool**: add `"tool": true` for a
calculator or other small utility that belongs beside Hikari's bench tools
rather than in the dock (§1.7).

Served and remote plugins differ in one thing that matters more than the
mechanics: with a served plugin the code is in the folder you installed and
you can read it. With a remote one it is on someone else's server and can
change tomorrow. That is why only the first may hold permissions.

### 1.1 Local and served plugin layout

Identical — `serve: true` is retained for compatibility; both use loopback
delivery:

```
notebook-results/       <- folder name MUST equal the manifest "id"
├── plugin.json         <- REQUIRED  manifest
├── index.html          <- REQUIRED  entry page, at the folder root
├── main.js             <- optional  anything below here is yours
├── hikari.js           <- optional  the host API client, if you use it
├── style.css
└── assets/…
```

Everything below the root is unconstrained. `index.html` is loaded like a
normal webpage, so relative stylesheets, classic scripts, images, and
subfolders resolve against the plugin folder. Both local and explicitly served
plugins can use relative ES module imports (§5.4). There is no build step and
no framework requirement.

Because every folder plugin is served over its own loopback origin, the folder
is also the web root: `/lib/app.js` means `<plugin folder>/lib/app.js`. Nothing
outside the folder is reachable (§4.4).

### 1.2 Remote plugin layout

```
my-remote-app/
└── plugin.json         <- REQUIRED, and that is the whole plugin
```

### 1.3 Validation rules

| Rule | Failure message |
| --- | --- |
| Absolute folder path | `Plugin folder path must be an absolute path.` |
| `plugin.json` exists and parses as a JSON object | `Plugin folder does not contain plugin.json.` / `plugin.json is not valid JSON.` |
| `id` present, lower-case kebab-case | `Plugin id "X" must be lower-case kebab-case…` |
| **folder name equals `id`** | `Plugin folder must be named "X" to match the manifest id…` |
| `name` present | `plugin.json is missing the required "name" field.` |
| `version` present, `major.minor.patch` | `plugin.json needs a "version" like "1.0.0"…` |
| `permissions`, if present, is an array of known capability names | `plugin.json "permissions" must be an array.` / `Unknown permission "X". Allowed: …` |
| `icon`, if present, is a relative `.svg` path that stays inside the folder: a regular file of at most 32 KiB containing an `<svg>` element | `Invalid plugin icon: …` |
| `index.html` at the folder root — everything except **remote** (for a service it is a script host, not a page — §1.6) | `Plugin folder does not contain index.html.` |
| `embed`, if present, is an absolute **https** URL | `plugin.json "embed" must use https…` |
| `embed` and `permissions` are mutually exclusive | `A plugin with "embed" cannot request host permissions…` |
| `serve`, if present, is a boolean | `plugin.json "serve" must be true or false.` |
| `serve` and `embed` are mutually exclusive | `plugin.json cannot set both "serve" and "embed".` |
| `service`, if present, declares a non-empty `fileConversions` array of bare lower-case `{ from, to }` extensions | `plugin.json "service" must declare a non-empty "fileConversions" array.` |
| `service` excludes `embed` and `serve` | `plugin.json a "service" plugin cannot also use "embed" or "serve".` |
| `tool`, if present, is a boolean | `plugin.json "tool" must be true or false.` |
| `tool` excludes `embed` and `service` | `plugin.json a "tool" plugin cannot also use "embed" or "service".` |
| a tool does not request `layout` or `agent:chat` | `A "tool" plugin cannot request "X" — Tools owns its rail, toolbar, and chat.` |

Source of truth:
[`src/main/lib/inspect-plugin-folder.js`](../../src/main/lib/inspect-plugin-folder.js).

### 1.4 `plugin.json`

```json
{
  "id": "notebook-results",
  "name": "Notebook Results Import",
  "version": "1.0.0",
  "description": "Attach a measurement table to a notebook entry.",
  "permissions": ["notebook:read", "notebook:write"]
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | **yes** | Lower-case kebab-case. Must equal the folder name. Identity key — two installed plugins cannot share one. Changing it is a new plugin. |
| `name` | string | **yes** | Display name in navigation and Settings. Max 120 chars. |
| `version` | string | **yes** | `major.minor.patch`. Shown in Settings; Hikari does not currently act on it. |
| `description` | string | no | Shown in Settings and as the view subtitle. Max 400 chars. |
| `icon` | string | no | Relative SVG file path inside the plugin folder, e.g. `icon.svg`. Maximum 32 KiB. Displayed as a monochrome image mask in the dock and More menu; use a square view box, transparent background, and simple strokes. Refreshed on app reload. SVG markup is never inserted into the host document. |
| `permissions` | string[] | no | Host API capabilities. Defaults to `[]`. Rejected alongside `embed`. |
| `settings` | object[] | no | Declarative preferences rendered in Settings → Plugins. Requires the `settings` permission. See [plugin-settings.md](plugin-settings.md). |
| `serve` | boolean | no | Legacy explicit opt-in to loopback delivery; local folders now receive this automatically. Rejected alongside `embed`. |
| `embed` | string | no | Absolute **https** URL. Makes this a remote plugin: `index.html` is not required and host permissions are refused. |
| `service` | object | no | Makes this a headless service. `{ "fileConversions": [{ "from": "dna", "to": "gbk" }] }`. No view is created. Rejected alongside `embed`/`serve`. See [service-plugins.md](service-plugins.md). |
| `tool` | boolean | no | `true` mounts the plugin as a tile and panel in **Tools** instead of as an app (§1.7). Rejected alongside `embed`/`service`, and with the `layout` or `agent:chat` permissions. |

Unknown fields are ignored, so new optional fields can land later without
breaking existing plugins.

### 1.5 Permissions

A plugin can only call host verbs covered by a permission it declared. There is
no runtime consent prompt: the manifest *is* the grant, and the user sees the
full list on the plugin's row in Settings before enabling it.

| Permission | Grants |
| --- | --- |
| `protocols:read` | List protocols and read one in full (steps, materials, troubleshooting). |
| `projects:read` | List project ids and names. |
| `samples:read` | List sample ids, names, and types. |
| `chemicals:read` | List compound names, molecular weights, pKa values, and forms: the user's inventory chemicals merged with Hikari's reference compounds, the same list the built-in Buffer Preparer uses ([plugin-api.md `chemicals.list`](plugin-api.md#chemicalslist--chemicalsread)). No quantities or locations. |
| `notebook:read` | List notebook entries and read one in full. |
| `notebook:write` | Append result text and result tables to an **existing** notebook entry. |
| `storage` | Read and replace the plugin's **own** persisted JSON blob (§3.1). Grants nothing outside that slice. |
| `settings` | Read and patch only the plugin's own declared preferences; receive `settings.changed` when they change. The manifest schema adds host-rendered controls to Settings → Plugins. See [plugin-settings.md](plugin-settings.md). |
| `files` | Read and write files in the plugin's **own** folder under the storage root (§3.2). Grants nothing outside that folder. |
| `downloads` | Open a native save dialog for plugin-generated bytes. The user chooses the destination; the plugin receives no path. |
| `python` | Run Python in the host's sandbox — a throwaway directory per run, deleted when it ends ([plugin-api.md `python.run`](plugin-api.md#pythonrun--python)). This is the one permission that executes code outside the frame; grant it deliberately. |
| `notifications` | Ask Hikari to show an attributed, transient success or error toast ([plugin-api.md `notifications.show`](plugin-api.md#notificationsshow--notifications)). Grants no control over markup, placement, actions, or persistence. |
| `agent:chat` | Give the plugin's view an independent Agent Chat rail, with conversations per plugin or per item: submit prompts, select the current item, and open or fold the rail ([plugin-api.md §5](plugin-api.md#5-agent-verbs)). Needs Codex sign-in. |
| `agent:canvas` | Receive `plugin_canvas` requests through `agent.canvas` and acknowledge with `agent.respond`, so the agent can read, edit, and render the plugin's own scene. The plugin owns its scene contract. Also needs **Settings → Tool access → Plugin canvases**. |
| `layout` | Commit the shared left-rail width and the plugin's rail fold state, put controls in Hikari's right toolbar, and add actions to the Protocol `…` menu and the PDF text-selection toolbar. Clicking such an action hands the plugin that one protocol, or the selected passage with its paper's saved Markdown ([plugin-api.md §4](plugin-api.md#4-layout-and-host-ui-verbs)). |

Declare the narrowest set that works. There is deliberately no permission for
creating or deleting records, reading general app settings, or directly touching the filesystem —
see [plugin-api.md §7](plugin-api.md#7-what-the-api-deliberately-does-not-do).

**Remote plugins get none of these**, and a manifest that requests both `embed`
and `permissions` is rejected at install. A permission is a grant to code the
user could read in the folder they installed; remote code can change after
review, so it never receives one. The frame is also never registered with the
bridge, so the API is absent rather than merely denied.

### 1.6 A service has no UI

A service plugin is headless. It has no view, no navigation entry, no rail, and
it must not render anything:

- **It ships no page.** Its `index.html` is a *script host*, not a UI: the
  sandbox needs a document to run a script in, and that is all this file is. It
  should contain nothing but `<script>` tags — no markup, no styles.
- **Its code touches no DOM.** A service listens for host calls and answers
  them. Reaching for `document` is the signal that what you are building is a
  view plugin, not a service.
- **The host enforces it.** The service frame is mounted `hidden` *and* pinned
  to `display: none` by `.plugin-service-frame`, so a service cannot show UI
  even if its document does contain markup.

If your extension needs to show something, it is a view plugin (§1.0) — a
plugin may be one or the other, not both.

### 1.7 A tool lives in Tools

`"tool": true` turns a local plugin into one more tool beside Molarity
Calculator, Buffer Preparer, and the other built-in bench tools:

```json
{
  "id": "buffer-ratio",
  "name": "Buffer Ratio",
  "version": "1.0.0",
  "description": "Base-to-acid ratio for a target pH, from the buffer's pKa.",
  "tool": true,
  "permissions": ["chemicals:read"]
}
```

- **Where it appears.** A tile labelled with the plugin's `name`, after the
  built-in tools in the **Tools** rail. Clicking it shows the tool's panel: a
  head with the `name` and `description`, drawn by Hikari like every other
  tool's head, and the plugin's frame filling the rest of the tool area.
- **What it does not get.** No dock or **More** entry, no topbar-search entry,
  and no view of its own. Tools owns the left rail and the right toolbar and
  has no agent chat rail, so a tool may not request `layout` or `agent:chat`;
  the manifest is rejected if it does.
- **Everything else is a local plugin.** The same folder layout, loopback
  origin, sandbox, client, and permissions. It runs from boot whether or not
  its panel is shown, like any view plugin.
- **The page.** Ship only the controls: the head already shows the title.
  The frame is at least 420 px tall. [plugin-api.md §1.2](plugin-api.md#12-tool-plugins)
  lists how each verb behaves from a tool.

[`examples/plugins/cell-seeding`](../../examples/plugins/cell-seeding/) is the
reference tool: a hemocytometer count to a plate-seeding plan, saved to a
notebook page. [`examples/plugins/buffer-ratio`](../../examples/plugins/buffer-ratio/)
is the minimal one, reading pKa values through `chemicals.list`.

---

## 2. Installing and managing plugins

1. **Settings** (gear app) → **Plugins**, then either:
   - **Add Plugin Folder** and pick the folder. It is validated against §1 on
     the spot; a rejected folder shows the exact reason in the status line. The
     plugin is saved turned on.
   - **Install from GitHub** with a root `https://github.com/owner/repo` URL.
     Hikari shallow-clones the default branch into its app data, names the
     folder after the manifest `id`, and applies the same validation. A plugin
     that requests any permission is saved turned **off**: a pasted URL is code
     the user has not read, so they review its host access on the row and turn
     it on. Publishing rules: [github-installation.md](github-installation.md).
2. Click **Reload App** to boot it.
3. After reload it appears in the dock after the built-in apps (or under
   **More** when the dock runs out of room), with its manifest `icon` or
   Hikari's generic plug icon, and takes part in topbar search and startup-view
   logic like any built-in app. A tool plugin appears as the last tile in
   **Tools** instead (§1.7), and its Settings row says so.

Each row shows name, version, description, **declared host access**, and folder
path, plus an On/Off toggle, a **Remove** button, and a **Preferences** form when
the manifest declares `settings` (§3.3). Removing forgets the settings entry;
the folder on disk, including a GitHub checkout, is never touched.

Hikari may also ship a plugin as **internal bundled source**. Its implementation
lives in [`src/plugins/<id>/`](../../src/plugins/), so users never select or
install its folder. It still uses the same manifest, iframe sandbox, bridge,
public API, and navigation lifecycle as an installable plugin. Its private
`@bundled/<id>` path token is resolved inside the application package, it is
always restored during state normalization, it cannot be removed, and it can
still be turned Off. Gel Analysis is the first internal plugin.

Internal distribution is not extra trust: it does not permit imports from the
renderer, direct DOM access, preload access, or unrestricted filesystem access.
Hikari contributors should follow
[`src/plugins/README.md`](../../src/plugins/README.md) for registration,
packaging, and verification. Third-party developers should use the install flow
above and the examples under [`examples/plugins/`](../../examples/plugins/).

Add, toggle, and remove all take effect on the **next reload** — navigation and
views are constructed once at boot (§4).

---

## 3. What gets stored

Installed plugins live in `state.settings.plugins`:

```json
{
  "id": "notebook-results",
  "name": "Notebook Results",
  "version": "1.0.0",
  "description": "Attach a results table to a notebook entry.",
  "permissions": ["notebook:read", "notebook:write"],
  "settings": [],
  "path": "/Users/me/plugins/notebook-results",
  "entryUrl": "file:///Users/me/plugins/notebook-results/index.html",
  "embedUrl": "",
  "serve": false,
  "service": null,
  "tool": false,
  "enabled": true
}
```

The icon is not stored: it is read from the folder again at every boot (§4.1).
The cached display name is also refreshed from a valid manifest with the same
plugin ID, including for disabled workspace plugins. Navigation, Settings, and
the view's accessible labels use the current name; permission grants, file paths,
and plugin identity keep their installed values.

- `entryUrl` is computed once at install time in the main process
  (`url.pathToFileURL`), so the renderer never does path→URL conversion and
  Windows paths are handled correctly. The frame is never pointed at it: at
  boot the folder is served over loopback (§4.4) and the frame loads that
  address instead. `entryUrl` remains the record that the folder was
  validated.
- `normalizePluginEntries()` in
  [`state-normalizer.js`](../../src/renderer/modules/app-state/state-normalizer.js)
  re-validates the array on load: entries without an `id`/`entryUrl`, or with
  duplicate ids, are dropped.
- **Manifest fields are a snapshot taken at install time — including
  `permissions`.** Editing `plugin.json` after install changes nothing until
  you remove and re-add the plugin. This is what stops a plugin from silently
  widening its own access on a later launch. Changes to HTML/CSS/JS need no
  re-add; those files are read live from disk on every boot.

### 3.1 Plugin storage

A plugin holding the `storage` permission gets a persisted JSON blob of its own
at `state.settings.pluginStorage[<plugin id>]`, read and written with
`storage.get` / `storage.set` ([plugin-api.md §3](plugin-api.md#3-write-verbs)).

- It is **capped per plugin** (`MAX_PLUGIN_STORAGE_CHARS` in
  [`plugin-storage.js`](../../src/renderer/lib/plugin-storage.js), 1 000 000
  characters). App state is one `localStorage` record for the whole app, so an
  unbounded blob would break every later save, not just the plugin's — the cap
  is enforced on write *and* again on load, where an imported or hand-edited
  state gets an over-cap blob dropped rather than carried into storage.
- It **outlives the plugin record.** Removing a plugin in Settings forgets the
  install entry but keeps the blob, so re-adding the plugin finds its data.
  Nothing in the UI clears it today; a user who wants it gone edits or re-imports
  their state.
- It travels with state export/import like any other setting.

### 3.2 Plugin files

A plugin holding the `files` permission also gets a folder at
`<storage root>/Plugins/<plugin id>/` (Figura uses `Plugins/Figura/` while
retaining its installed `scientific-illustration` id), addressed with `files.write` /
`files.read` and relative paths only.

- **Containment is enforced in the main process.** Dedicated plugin-file IPC
  validates the plugin id and relative path, resolves the configured root, and
  rejects symlinks anywhere beneath it, including `Plugins/`, the plugin
  directory, intermediate directories, and the file itself. See
  [`plugin-files.js`](../../src/main/lib/plugin-files.js). Writes replace the
  addressed file atomically; a failed write retains the previous file.
- **The storage root must be configured.** Without one the verbs refuse rather
  than falling back to somewhere else.
- **Files outlive the plugin record**, like the storage blob, and removing a
  plugin never deletes them.
- This is what makes a real workspace portable: the gel plugin writes the same
  `source.png` / `analysis-result.json` / `gel-record.json` artifacts the
  built-in module used to, just under its own folder.

### 3.3 Plugin preferences

A plugin holding the `settings` permission and declaring a manifest `settings`
schema keeps its preference values at
`state.settings.pluginSettings[<plugin id>]`, separate from its storage blob,
and read and written with `settings.get` / `settings.set`. Only values that
differ from a declared default are stored. Like the blob, they outlive the
plugin record and travel with state export/import. Full contract:
[plugin-settings.md](plugin-settings.md).

---

## 4. How the app boots a plugin

### 4.1 Boot sequence

`startHikariCore()` in
[`start-hikari-core.js`](../../src/renderer/core/start-hikari-core.js) builds
the plugin bridge and calls `installPlugins()` immediately after `loadState()`
— **before** `createNavigationShell()`, which snapshots both the `.view` DOM
sections and `APP_REGISTRY` at construction time.

For each entry with `enabled !== false`,
[`plugin-loader.js`](../../src/renderer/app/plugin-loader.js):

1. **Creates a view section** appended to `.workspace-main`, holding nothing
   but the frame:

   ```html
   <section id="plugin-<id>-view" class="view plugin-view">
     <div class="plugin-view__main">
       <iframe class="plugin-frame" src="<loopback URL>"
               sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
               title="<name> — <kind>, host access: …">
     </div>
   </section>
   ```

   **The frame gets the whole pane, with no host chrome around it.** A plugin
   lays out its own page exactly like a built-in view does — including its own
   left rail, if it wants one.

   This was not always true. The frame used to be wrapped in the shared
   left-rail template with a host-drawn rail carrying the plugin's name, kind,
   description, and host access, on the theory that a plugin should read as a
   real workspace rather than a bare iframe. That was backwards for any plugin
   that *is* a workspace: a ported view brings its own rail, so the host's sat
   outside it holding five lines of static text, and the real rail — the one
   with the controls — was pushed ~280px inward. Two rails, and the empty one
   outermost.

   Identity did not disappear with it. The plugin's name is the topbar title
   and its entry in navigation and search; the kind, origin, and host access are
   the frame's `title` and `aria-label` (`describePlugin()` in
   [`plugin-loader.js`](../../src/renderer/app/plugin-loader.js)). And the
   disclosure that actually gates trust was never the rail: it is the permission
   list on the plugin's row in Settings, shown before the plugin is enabled
   (§2).

2. **Starts the loopback server and registers the frame with the bridge**,
   binding both its `contentWindow` and assigned origin to the installed record
   before navigation. Remote frames receive no bridge entry.

   For every folder plugin the `src` is initially empty and filled in
   asynchronously, once the main process reports the loopback URL over
   `plugins:serve-folder`. The section and the registry entry are still created
   synchronously, because the shell snapshots both; only the URL arrives late.
   A plugin whose server fails to start shows the reason inside its own frame
   rather than breaking the boot.

   A **service** uses the same per-plugin loopback delivery automatically even
   though its manifest does not set `serve: true`. Packaged Electron refuses to
   load sibling scripts from an installed folder through an external `file:`
   frame. The service frame remains hidden, creates no section or app-registry
   entry, and queues conversion requests until its worker posts
   `service:ready` after installing the request listener.

3. **Pushes an app entry into `APP_REGISTRY`** with `id: plugin-<id>`,
   `viewId: plugin-<id>-view`, the name/description, and `placement: 'more'`.
   A plugin that declares `agent:chat` also gets `agentChatRail: true`, the
   host's chat rail beside its view. Installable plugins get the generic plug
   icon until `loadPluginIcons()` re-inspects each folder later in boot, before
   navigation is first drawn, and swaps in the manifest `icon` as a base64
   image painted through a host-owned `currentColor` mask. The same inspection
   refreshes the plugin's display name after a manifest rename. An internal bundled
   definition may provide trusted `iconMarkup`, such as Gel's electrophoresis
   mark; manifest-provided host markup is never accepted.

A **tool** plugin skips steps 1 and 3. `installToolFrame()` appends a tile to
`#tool-box-view .tool-grid` and a hidden `.tool-subview.plugin-tool` panel,
holding the head and the frame, to `.tool-content`, then serves and registers
the frame as in step 2. It must run before Tools initializes, because
[`view-manager.js`](../../src/renderer/modules/tool-box/view-manager.js) binds
every `.tool-tile` and `.tool-subview` once, at module init; boot order
guarantees this. `loadPluginIcons()` refreshes the tile label and head after a
manifest rename. A tool's frame is undo-capable while its panel is the visible
tool ([`plugin-history.js`](../../src/renderer/app/plugin-history.js)).

Because plugin apps are ordinary registry entries created before the shell
boots, everything downstream works with zero plugin-specific code: dock/more
navigation, `showView()` toggling, topbar search aliases, valid-startup-view
checks, and the topbar title/subtitle.

This is also why changes need a reload: the shell does not support adding or
removing apps after construction.

### 4.2 Install-time validation

The renderer cannot touch the filesystem, so folder validation is an IPC call:

- Channel `plugins:inspect-folder` (`PLUGINS.INSPECT_FOLDER` in
  [`channels.js`](../../src/shared/ipc/channels.js))
- Handler registered in
  [`register-plugin-ipc.js`](../../src/main/ipc/register-plugin-ipc.js), wrapping
  [`inspect-plugin-folder.js`](../../src/main/lib/inspect-plugin-folder.js)
  (and [`plugin-icon.js`](../../src/main/lib/plugin-icon.js) for `icon`)
- Preload: `window.hikariApi.inspectPluginFolder(path)` in
  [`plugin-api.js`](../../src/main/preload/api/plugin-api.js)

On success it returns `{ ok: true, id, name, version, description,
iconDataUrl, permissions, settings, path, entryUrl, embedUrl, serve, service, tool }`.
Settings stores everything except `iconDataUrl`, plus `enabled` (§2). The
directory picker reuses `storage:pick-directory`.

**Install from GitHub** goes through `plugins:install-github`
(`PLUGINS.INSTALL_GITHUB`), exposed as
`window.hikariApi.installPluginFromGitHub(url, installedPluginIds)` and
implemented in
[`install-github-plugin.js`](../../src/main/lib/install-github-plugin.js). It
shallow-clones over HTTPS only — no submodules, Git LFS contents, hooks, or
credential prompts — into a `.install-*` staging folder under
`<userData>/plugin-repositories/`, rejects symbolic links, renames the checkout
to the manifest `id`, validates it with `inspectPluginFolder`, and only then
moves it to a permanent `<uuid>/<id>` folder. Failed clones, failed validation,
and duplicate ids remove the staging folder. The result adds `repositoryUrl`,
which the renderer uses to save a plugin that requests permissions turned off
(§2). Publishing rules for repository authors are in
[github-installation.md](github-installation.md).

### 4.3 Settings panel

- Markup: the **Plugins** section (`data-settings-panel="plugins"`) in
  [`ui/html/views/setting-view.html`](../../ui/html/views/setting-view.html)
  (`index.html` is generated — edit the fragment, then `npm run build:ui`).
- Elements resolved in [`settings/dom.js`](../../src/renderer/modules/settings/dom.js).
- Logic in
  [`settings/plugins-controller.js`](../../src/renderer/modules/settings/plugins-controller.js).
- Manifest-declared preferences use
  [`settings/plugin-preferences-controller.js`](../../src/renderer/modules/settings/plugin-preferences-controller.js).
  Their values are separate from data blobs, under
  `state.settings.pluginSettings[pluginId]`; see [plugin-settings.md](plugin-settings.md).

### 4.4 Serving a plugin folder

For all local/served view plugins and service plugins the renderer calls
`window.hikariApi.servePluginFolder(id, path)` (channel
`plugins:serve-folder`), which asks the main-process registry in
[`plugin-server.js`](../../src/main/lib/plugin-server.js) to start — or reuse —
a loopback server rooted at that folder, and returns its base URL. The
renderer requires a loopback origin via `pluginOrigin()` before assigning it
as the frame `src`, so a compromised reply cannot widen the sandbox. Server
constraints are in §5.2.

---

## 5. Security model

Plugins are untrusted third-party code and run with the least privilege the
platform offers.

- **Sandboxed iframe.** Folder plugins receive their own loopback origin with
  `allow-scripts allow-forms allow-modals allow-popups allow-same-origin`. They
  remain cross-origin from the host DOM and host storage. Before the server
  responds, the empty frame stays opaque and has no bridge grant.
- **No Node, no preload bridge.** The renderer runs with
  `contextIsolation: true` / `nodeIntegration: false`, and Electron preload
  scripts do not run in subframes, so plugins never see `window.hikariApi`.
- **The host API is the only channel in, and it is narrow.** Every request
  crosses `postMessage` and is checked against both the *frame identity* and
  *assigned origin*. A call from another origin revokes the frame grant. Replies,
  broadcasts, and service requests target the assigned origin explicitly, so
  navigating the frame cannot transfer access to the replacement document. Handlers copy and clamp the fields they return
  rather than handing back live state objects.
- **Host UI contributions are declarative.** Workspace tools and context
  actions are validated descriptions: Hikari draws their labels as text and
  their icons from its own catalog, and sends clicks only to the registering
  frame and origin. A context action hands over just the source the user
  clicked, once, and only to that frame.
- **Grants are frozen at install time.** Editing `permissions` in an installed
  plugin's manifest has no effect until the user re-adds it (§3).

### 5.1 Why plugin frames may use `allow-same-origin`

All running plugin frames carry `allow-same-origin`. This would be unsafe on a
`file://` frame, which could share the host origin. Hikari instead uses real
origins separate from its own:

- Remote: the embedded site's https origin.
- Local, served, and service: `http://127.0.0.1:<random port>`. The host runs from `file://`, and
  a distinct port is a distinct origin, so they never coincide. Each served
  plugin gets its **own** port too, so plugins cannot read each other's
  storage either.

Within one run that holds, because a live server owns its port. Across runs it
does not: the OS assigns the port, `localStorage` and `IndexedDB` outlive the
process keyed by origin, and the port a plugin is handed today may be the one a
*different* plugin's storage is still filed under. So a newly bound origin is
emptied — `session.clearStorageData({ origin })` — before the plugin is allowed
to load on it. A host that cannot empty it refuses to serve the plugin at all
rather than hand over a neighbour's data. Reusing a server already running for
that plugin does not clear anything, so storage survives renderer reloads; it is
a fresh app run that starts empty. That is why durable plugin data belongs in
the `storage` and `files` verbs (§3.1, §3.2) and not in browser storage.

Measured both ways, from the host, against a served frame:

```
frameSrc:            http://127.0.0.1:59543/
contentDocument:     null (blocked)
frameLocalStorage:   blocked (SecurityError)
```

Real applications need this. An opaque origin denies `localStorage` *and*
`IndexedDB` with a `SecurityError`, and anything WebAssembly-based — ImageJ.JS
included — keeps its filesystem in IndexedDB. It does not degrade: `cheerpjInit`
simply never resolves.

The flag is gated on an **origin check, not a manifest field**. Folder frames
require a validated `http://127.0.0.1` URL from the main process; `entryUrl` is
never loaded directly. Remote embeds must pass the HTTPS manifest and state
validation and receive no host grant. A `file:` URL cannot enter a frame
carrying `allow-same-origin`.

### 5.2 The plugin server

All folder view plugins and headless service plugins are delivered by
[`plugin-server.js`](../../src/main/lib/plugin-server.js), a Node `http` server
in the main process. Its constraints:

- **Loopback only.** Binds to `127.0.0.1` on an OS-assigned port, so it is not
  reachable from the network.
- **One server per plugin**, because a port is what separates origins. Sharing
  one would put every served plugin in a single origin.
- **The plugin folder is the entire web root.** Requests are resolved against
  it and then checked to still be inside it, so `../`, percent-encoded
  traversal (`%2e%2e`, `..%2f`), null bytes, and symlinks pointing outward all
  fail closed. This is the trust boundary — the URL comes from inside an
  untrusted frame — and it is tested directly (§9).
- **GET and HEAD only**, `no-store`, `nosniff`, and a small fixed MIME table
  (unknown extensions are served as `application/octet-stream`, never guessed).

Servers start lazily when a served view or service plugin mounts, are reused
across renderer reloads when the canonical folder is unchanged, and die with
the app. Reinstalling an id from a different folder replaces and closes its old
server. Symlinked installation roots are canonicalized before containment checks.
Every newly bound origin is emptied before its URL reaches the renderer (§5.1).

### 5.3 What none of this prevents

A plugin page can make outbound network requests like any webpage, and
`allow-popups` lets it open windows. **A plugin with `notebook:read` can read
your notebook and POST it anywhere.** Permissions bound what a plugin can touch
inside Hikari; they cannot stop it from exfiltrating what it is allowed to see.

For a **remote** plugin the exposure is different in kind, not degree: it holds
no host permissions, but you are running third-party code that can change at
any time, and **anything you open inside it has left your machine** — it went
to their site, not into Hikari. Treat a remote plugin as what it is, a bookmark
with a workspace around it.

Only install plugin folders you trust, and for remote plugins, only embed sites
you trust.

### 5.4 Loading local scripts

Local and served plugins both load from loopback. Classic scripts, relative ES
modules, stylesheets, and images work without adding `serve: true`. Earlier
versions loaded default local plugins from an opaque `file:` frame, which
Electron blocks from loading sibling assets; that delivery path is no longer
used.

The copyable `hikari.js` client remains a classic script. Load it before code
that calls `window.HikariPlugin.hikari`:

```html
<script src="./hikari.js"></script>
<script src="./main.js"></script>
```

### 5.5 The CSP has to admit the plugin's origin

A served or service plugin's frame loads from `http://127.0.0.1:<random port>`, and the
app's own Content-Security-Policy decides whether that is allowed at all. The
`frame-src` directive in
[`ui/html/shell/start.html`](../../ui/html/shell/start.html) therefore reads:

```
frame-src 'self' blob: http://127.0.0.1:* hikari-html:;
```

(`hikari-html:` is the agent's sandboxed HTML preview, not a plugin.)

There is no IPv6 counterpart: CSP `host-source` has no grammar for an address
literal, so `http://[::1]:*` is discarded as invalid (with a console warning at
every boot). The plugin server binds `127.0.0.1` and nothing else, and
`isSameOriginSafeUrl()` refuses `[::1]` to match.

Without the loopback entry the browser blocks the frame outright and a served
plugin renders as an **empty pane** — no console error, no failed host call,
nothing that points at the cause. Permissions, sandbox flags, and the plugin
server can all be correct while nothing runs. There is a contract test for this
(§9).

The wildcard port is unavoidable: `plugin-server.js` binds to an OS-assigned
port. It widens nothing meaningful — the frame still gets only its own origin,
and `isSameOriginSafeUrl()` re-checks the URL before the sandbox is chosen.

**Remote (`embed`) plugins are not enabled by this.** They would need `https:`
in `frame-src`, which permits framing any https origin, and that is a broader
decision than serving a folder from loopback. A remote plugin installs and
navigates today but its frame will not load until that entry is added.

---

## 6. Limitations

- **Reload to apply.** Add/enable/disable/remove all require an app reload.
- **Metadata is snapshotted** (§3), deliberately.
- **Host API is read-mostly.** One verb writes to the user's records,
  `notebook.appendResult`, and it can only append to entries they already
  created. A plugin's own data goes in its storage blob (§3.1).
- **Icons are images, placement is fixed.** An installable plugin's `icon` is
  shown only as a single-color mask, never as host SVG markup, so multicolor
  artwork flattens. Installed plugins always follow the built-in apps
  (`placement: 'more'`). Source-owned internal definitions may provide audited
  icon markup.
- **No host chrome inside the view** (§4.1). The frame is the whole pane, so
  a plugin draws its own rail, toolbar, and navigation. Its only routes into
  the app's chrome are bridge verbs the host renders
  ([plugin-api.md §4](plugin-api.md#4-layout-and-host-ui-verbs)): the shared
  rail width and fold state, buttons in the right toolbar, and actions in the
  Protocol `…` menu and the PDF selection toolbar. Anything else stays inside
  the frame.
- **One tile per tool plugin, after the built-in tools.** A tool cannot add
  several tiles, choose its position, or show an icon; Tools tiles are text.
- **No inter-plugin communication**, and no background execution — a plugin
  only runs while its view exists.
- **Durable persistence uses the host APIs.** Browser storage works for the
  life of the loopback origin and survives renderer reloads, but every app run
  starts empty — deliberately, because ports are recycled across runs (§5.1).
  Use `storage` (§3.1) for durable records and `files` (§3.2) for larger
  artifacts.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Plugin folder does not contain plugin.json.` | The manifest is required now. See §1.1 for the minimum. |
| `Plugin folder must be named "X" to match the manifest id` | Rename the folder to the `id`, or change the `id` to the folder name. |
| `plugin.json needs a "version" like "1.0.0"` | Three numeric parts. `"1.0"` and `"v1.0.0"` are rejected. |
| `Unknown permission "…"` | Typo, or a capability that does not exist. Allowed names are in §1.5. |
| `Invalid plugin icon: …` | `icon` must be a relative path to an `.svg` file inside the folder, at most 32 KiB. Remove the field to use the generic icon. |
| `Unknown verb "…"` for a verb in [plugin-api.md](plugin-api.md) | An older Hikari build. Keep a local fallback and feature-detect, e.g. `app.info.layout.workspaceTools.available` ([plugin-api.md §4](plugin-api.md#4-layout-and-host-ui-verbs)). |
| Workspace tools or context actions do not appear | Declare `layout` (then remove and re-add). Tools show only while the plugin's view is active; `requiresAgent` actions are hidden while Codex is not connected. |
| `agent.chat` resolves `{ ok: false }` | Read `reason`: `unavailable` means Codex is not connected; `busy` and `composer_not_empty` mean the chat is in use. An `agent:canvas` plugin also needs **Settings → Tool access → Plugin canvases**. |
| Plugin added but not in navigation | Reload the app (Settings → Plugins → Reload App). A tool plugin is never in navigation: look for it at the end of the **Tools** rail. |
| `A "tool" plugin cannot request "layout"` (or `"agent:chat"`) | Tools owns the rail, toolbar, and chat. Remove the permission, or drop `"tool": true` to make a workspace plugin. |
| Local scripts fail to load | Reload with the current app version and check that the plugin folder still exists. All local assets now load from loopback (§5.4). |
| Blank plugin view | Open DevTools; the page failed like any webpage would (bad script path, JS error). Paths inside the plugin must be relative. Add an in-frame loading/error state so users see the failure too. |
| `…did not declare the "X" permission in plugin.json` | Add it to `permissions`, then **remove and re-add** the plugin — grants are snapshotted. |
| Host calls time out | The frame is not registered: the plugin is disabled, or the page is open outside Hikari (e.g. straight in a browser). |
| `localStorage` / `IndexedDB` empty after an app restart | Expected. A recycled loopback port would otherwise hand you another plugin's storage, so each run starts the origin empty (§5.1). Use `storage` and `files` for durable data. |
| The UI says “saved,” but data is missing | Only show success after every awaited API call resolves. `storage.set` rejects a missing `value`, and `files.write` rejects invalid base64 or a downstream disk failure. |

---

## 8. Graduating a plugin into a built-in module

Iframe plugins are deliberately bounded: no host DOM, agent access only through
the plugin's own chat rail and the generic `plugin_canvas` tool, and only the
API verbs in [plugin-api.md](plugin-api.md). An installable plugin's icon is
painted as a mask because inserting manifest-provided SVG into the host
document would be unsafe; source-owned internal plugins may carry a trusted
icon in their bundled definition. A plugin that draws its own left rail
can synchronize its width through `app.info`, `app.context`, and
`app.setLeftRailWidth`, but the rail and resize interaction still live inside
the iframe.

When an extension needs host-owned navigation order and chrome, direct module
integration, agent MCP tools, or its own skill, it graduates from a plugin
folder to a **first-class module** wired into the codebase:

- **Module, dock icon, and placement:** the general recipe in
  [docs/module-development/](../module-development/README.md), with the icon and
  `dockOrder` steps in
  [04-adding-a-new-module.md](../module-development/04-adding-a-new-module.md).
- **Shared left rail:** the `left-rail-template` layout and
  `data-sync-left-rail` in
  [02-html-and-css.md](../module-development/02-html-and-css.md#two-pane-layout-left-rail-template).
  A plugin cannot use that controller; it copies the markup into its own page
  and syncs width through
  [`app.setLeftRailWidth`](plugin-api.md#appsetleftrailwidth--layout), as the
  bundled Gel plugin does.
- **Agent MCP tools and module-owned skills:**
  [Adding a direct MCP tool](../agent/tools/tooling-walkthrough.md#adding-a-direct-mcp-tool)
  and [Skills](../agent/tools/tooling-walkthrough.md#skills).

---

## 9. Testing

`npm test` covers the folder contract, the sandbox decision, and the API gate:

- `inspect-plugin-folder enforces the required folder shape` — every rule in
  §1.3, each rejection asserted individually.
- `remote plugins require https and cannot hold host permissions` — `embed`
  replaces the `index.html` requirement; `http:`, `file:`, and relative embeds
  are refused, as is `embed` combined with `permissions`.
- `only non-host origins get allow-same-origin` — `isSameOriginSafeUrl()`
  accepts https and loopback http, refuses `http:` to a remote host, `file:`,
  `javascript:`, `data:`, and empty input. This is the check that decides the
  sandbox string, so it is tested directly (§5.1).
- `state normalizer strips unsafe embeds and remote permissions` — the
  hand-edited-settings path: a non-https `embedUrl` is dropped and a remote
  record loses its permissions on load.
- `plugin server: refuses to serve anything outside the plugin folder` — plain
  and percent-encoded traversal, null bytes, and prefix-sibling escapes. It
  asserts the invariant (never resolves outside the root) rather than any one
  rejection mechanism, because URL parsing normalizes some attacks away before
  the boundary check sees them and both routes are safe.
- `plugin server: serves files over loopback and 404s the rest` — binds to
  `127.0.0.1`, correct content types, 404 for missing files, 405 for non-GET,
  and a raw `../` request that bypasses `fetch()` normalization never returns
  the file next to the folder.
- `bridge gates verbs on manifest permissions and frame identity` —
  unregistered frames get no reply, undeclared permissions are refused,
  unknown verbs are refused, and a permitted write persists. Storage is
  covered here too: a plugin sees only its own slice, an over-cap or cyclic
  write is refused without disturbing what was already stored, and `null`
  clears.
- `the app CSP admits the loopback origin served plugins run on` — asserts
  `frame-src` in both the shell fragment and the generated `index.html`. A
  served plugin whose frame the CSP blocks fails silently (§5.5), so this is
  checked rather than assumed.
- `files verbs stay inside the plugin folder` — writes and reads round-trip
  under `Plugins/<id>/`, while `..`, absolute paths, drive letters, backslashes,
  and null bytes are all refused without touching the filesystem.
- `gel-plugin-selfcheck` ([`tests/`](../../tests/gel-plugin-selfcheck.mjs)) —
  runs the internal Gel plugin's own analysis pipeline and checks its manifest,
  bundled definition, and source-owned folder contract. The Gel UI suites in
  `tests/suites/edge/bio-tools-and-gel-suite/` run against that same copy, since
  it is the only implementation.
- `a plugin view is its frame, with no host chrome around it` — drives
  `installPlugins` against a minimal fake DOM and asserts each plugin view has
  no host rail and no rail template, one frame filling one pane, and the
  plugin's kind and host access on the frame's `title`/`aria-label`.
- `notifications are permission gated, attributed, and bounded`,
  `app context events and user-mediated downloads stay permission gated`,
  `python.run is permission gated and hands back no host paths`, and
  `plugin chat context updates only its owning view and validates item identifiers`
  pin down those verbs' permission gates and limits.
- `tool plugins mount inside Tools and read the compound list` — the `tool`
  manifest rules, remote records never normalized into tools, the tile and
  panel mounted in Tools with no view section or navigation entry, and
  `chemicals.list` gated on `chemicals:read` with inventory values winning.
- `every public verb and host event is documented` — fails when a public verb
  has no `###` heading in [plugin-api.md](plugin-api.md), or a listed host
  event is not mentioned there.
- The four `plugin settings: …` tests (`settings.js`) — schema validation at
  install, atomic partial patches that roll back on a failed save and store
  only overrides, imported state that never trusts a schema without the grant,
  and reads, writes, and `settings.changed` confined to the owning frame.
- The four `GitHub …` tests (`github-install.js`) — URL normalization, a real
  clone from a local fixture repository, cleanup and messages for every failure
  (missing Git, missing Command Line Tools, timeout, clone error, bad
  manifest, symlinks), and one install at a time.
- Service plugins have their own suite — see
  [service-plugins.md §7](service-plugins.md#7-testing).

The newer layout and host-UI pieces have focused unit tests outside `npm test`:

```bash
node --test tests/plugin-icon.test.mjs tests/plugin-left-rail.test.mjs tests/plugin-workspace-tools.test.mjs tests/plugin-context-actions.test.mjs tests/plugin-history.test.mjs
```

They cover icon confinement and markup safety, per-plugin rail folding,
undo routing (a tool frame claims history only while its panel is shown),
declarative workspace tools and their separate permission and origin checks,
and context-action handoffs: one source per click, expiry on navigation or
re-registration, Markdown path confinement, and explicit missing or truncated
paper context.

The core contracts live in `tests/suites/core/plugin-system-suite/` (registered
through [`test.js`](../../test.js)); copyable-client, Gel folder, and
`cell-seeding` example checks live in [`tests/`](../../tests/). For manual end-to-end checks, install
[`examples/plugins/notebook-results/`](../../examples/plugins/notebook-results/)
for the host API, and open the bundled Gel plugin for a production-sized served
plugin. [`plugins/scientific-illustration/`](../../plugins/scientific-illustration/)
exercises the agent, workspace-tool, and context-action verbs;
`node node_modules/electron/cli.js tests/scientific-illustration-electron.cjs`
drives it end to end, including the shared toolbar and source actions.

`node tests/plugin-boundaries-selfcheck.mjs` covers origin revocation, service
message routing, notebook fields, storage rollback, real filesystem symlinks,
server replacement, and that no origin is served before it has been emptied. It
needs loopback networking.

`node node_modules/electron/cli.js tests/plugin-runtime-electron.cjs` runs a
hidden Electron window with a temporary profile and the real preload. It checks
local asset loading, host isolation, navigation grants, loopback-origin
clearing, file IPC, notebook and storage persistence, headless conversion, and
a tool plugin reading `chemicals.list` from its Tools panel. It never opens
user data.

Two more Electron runs drive the real Settings UI:
`tests/settings-plugins-electron.cjs` covers folder and GitHub installs (a
permissioned GitHub plugin starts off), Remove, and the Reload App
unsaved-changes guard; `tests/plugin-settings-electron.cjs` covers the
Preferences form, persistence, and live `settings.changed` delivery. Run each
with `node node_modules/electron/cli.js <file>`.
