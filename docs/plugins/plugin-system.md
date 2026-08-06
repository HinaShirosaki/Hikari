# Hikari Plugin System

A plugin is a folder of web files that Hikari boots as a first-class app: it
gets a navigation entry, its own workspace view, and — if its manifest asks for
it — a narrow set of permission-gated host capabilities.

New plugin author? Start with the copyable
[**quickstart.md**](quickstart.md), then use this page for the complete folder
contract and lifecycle. Also see:

- [**plugin-api.md**](plugin-api.md) — the host API reference (every verb,
  its permission, its exact request/response shape).
- [**imagej-walkthrough.md**](imagej-walkthrough.md) — remote plugins: how
  [`examples/plugins/imagej/`](../../examples/plugins/imagej/) embeds real
  ImageJ, and where that trust boundary sits.

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
| Loaded from | `file://` | `http://127.0.0.1:<port>` | the remote URL | `file://` (hidden) |
| Runs as | opaque origin (`null`) | its own loopback origin | the remote site's origin | opaque origin (`null`) |
| Sandbox | `allow-scripts allow-forms allow-modals allow-popups` | the same **+ `allow-same-origin`** | the same **+ `allow-same-origin`** | same as local |
| `localStorage` / `IndexedDB` | **denied** | works | works | **denied** |
| Scripts | **classic only** (§5.4) | classic or module | (remote's own) | **classic only** (§5.4) |
| Has a view | yes (whole pane) | yes | yes | **no** — headless |
| Host API | may hold permissions | may hold permissions | **never** | may hold permissions |
| Example | [`hello-world`](../../examples/plugins/hello-world/) | [`imagej`](../../examples/plugins/imagej/) | — | [`snapgene-dna`](../../examples/plugins/snapgene-dna/) |

**Which to write:**

- **Local** by default. Simplest, most locked-down, no server.
- **Served** when the plugin needs storage — `localStorage`, `IndexedDB`, or
  any WebAssembly runtime that keeps a filesystem. An opaque origin denies all
  of it, so this is not a preference but a hard requirement (§5.1).
- **Remote** only to embed an existing web app you cannot bundle. It buys
  nothing except someone else's hosting, and costs you the host API entirely.
- **Service** to extend a built-in feature rather than add a workspace — today,
  teaching a feature to open a file format via conversion. Full details in
  [service-plugins.md](service-plugins.md).

Served and remote plugins differ in one thing that matters more than the
mechanics: with a served plugin the code is in the folder you installed and
you can read it. With a remote one it is on someone else's server and can
change tomorrow. That is why only the first may hold permissions.

### 1.1 Local and served plugin layout

Identical — `serve: true` changes how the folder is *delivered*, not what is
in it:

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
subfolders resolve against the plugin folder. A **served** plugin can also use
relative ES module imports. A local plugin has an opaque `file://` origin, so
browsers refuse those module fetches; use classic scripts there (§5.4). There
is no build step and no framework requirement.

For a served plugin the whole folder is reachable over its loopback origin, so
the folder is also the web root: `/ij153/ij.jar` means
`<plugin folder>/ij153/ij.jar`. Nothing outside the folder is reachable (§4.4).

### 1.2 Remote plugin layout

```
imagej/
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
| `permissions`, if present, is an array of known capability names | `Unknown permission "X". Allowed: …` |
| `index.html` at the folder root — everything except **remote** (for a service it is a script host, not a page — §1.6) | `Plugin folder does not contain index.html.` |
| `embed`, if present, is an absolute **https** URL | `plugin.json "embed" must use https…` |
| `embed` and `permissions` are mutually exclusive | `A plugin with "embed" cannot request host permissions…` |
| `serve`, if present, is a boolean | `plugin.json "serve" must be true or false.` |
| `serve` and `embed` are mutually exclusive | `plugin.json cannot set both "serve" and "embed".` |
| `service`, if present, declares a non-empty `fileConversions` array of bare lower-case `{ from, to }` extensions | `plugin.json "service" must declare a non-empty "fileConversions" array.` |
| `service` excludes `embed` and `serve` | `plugin.json a "service" plugin cannot also use "embed" or "serve".` |

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
| `permissions` | string[] | no | Host API capabilities. Defaults to `[]`. Rejected alongside `embed`. |
| `serve` | boolean | no | Serve the folder over `http://127.0.0.1:<port>` instead of `file://`, giving the plugin a real origin with working storage. Rejected alongside `embed`. |
| `embed` | string | no | Absolute **https** URL. Makes this a remote plugin: `index.html` is not required and host permissions are refused. |
| `service` | object | no | Makes this a headless service. `{ "fileConversions": [{ "from": "dna", "to": "gbk" }] }`. No view is created. Rejected alongside `embed`/`serve`. See [service-plugins.md](service-plugins.md). |

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
| `notebook:read` | List notebook entries and read one in full. |
| `notebook:write` | Append result text and result tables to an **existing** notebook entry. |
| `storage` | Read and replace the plugin's **own** persisted JSON blob (§3.1). Grants nothing outside that slice. |
| `files` | Read and write files in the plugin's **own** folder under the storage root (§3.2). Grants nothing outside that folder. |
| `downloads` | Open a native save dialog for plugin-generated bytes. The user chooses the destination; the plugin receives no path. |

Declare the narrowest set that works. There is deliberately no permission for
creating or deleting records, reading settings, or directly touching the filesystem —
see [plugin-api.md §5](plugin-api.md#5-what-the-api-deliberately-does-not-do).

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

---

## 2. Installing and managing plugins

1. **Settings** (gear app) → **Plugins**.
2. **Add Plugin Folder**, pick the folder. It is validated against §1 on the
   spot; a rejected folder shows the exact reason in the status line.
3. The plugin is saved as *enabled*. Click **Reload App** to boot it.
4. After reload it appears in the "More" menu with a plug icon and takes part
   in topbar search and startup-view logic like any built-in app.

Each row shows name, version, description, **declared host access**, and folder
path, plus an On/Off toggle and a **Remove** button. Removing forgets the
settings entry; the folder on disk is never touched.

Hikari may also ship a plugin as **bundled**. A bundled plugin uses the same
manifest, sandbox, bridge, and navigation lifecycle, but its folder is resolved
from the application package instead of a user-selected absolute path. It is
always restored during state normalization, cannot be removed, and can still be
turned Off. Gel Analysis is the first bundled plugin.

Add, toggle, and remove all take effect on the **next reload** — navigation and
views are constructed once at boot (§4).

---

## 3. What gets stored

Installed plugins live in `state.settings.plugins`:

```json
{
  "id": "imagej",
  "name": "ImageJ Measurements",
  "version": "1.0.0",
  "description": "Attach an ImageJ Results table to a notebook entry.",
  "permissions": ["notebook:read", "notebook:write"],
  "path": "/Users/me/plugins/imagej",
  "entryUrl": "file:///Users/me/plugins/imagej/index.html",
  "enabled": true
}
```

- `entryUrl` is computed once at install time in the main process
  (`url.pathToFileURL`), so the renderer never does path→URL conversion and
  Windows paths are handled correctly.
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
`<storage root>/Plugins/<plugin id>/`, addressed with `files.write` /
`files.read` and relative paths only.

- **Containment is enforced in the bridge**, not downstream: the host's own
  `readFileBase64` reads any absolute path it is handed, and `storeImportedFile`
  confines writes to the storage root but not below it. `resolvePluginFilePath()`
  in [`plugin-bridge.js`](../../src/renderer/app/plugin-bridge.js) is what keeps
  a plugin out of the user's notebook files, and it is tested directly (§9).
- **The storage root must be configured.** Without one the verbs refuse rather
  than falling back to somewhere else.
- **Files outlive the plugin record**, like the storage blob, and removing a
  plugin never deletes them.
- This is what makes a real workspace portable: the gel plugin writes the same
  `source.png` / `analysis-result.json` / `gel-record.json` artifacts the
  built-in module used to, just under its own folder.

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
       <iframe class="plugin-frame" src="<entryUrl>"
               sandbox="allow-scripts allow-forms allow-modals allow-popups"
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

2. **Registers the frame with the bridge**, mapping its `contentWindow` to the
   installed record. This is how the host later knows which plugin a message
   came from — and therefore which permissions apply. Remote frames are
   skipped: third-party code gets no bridge entry at all.

   For a **served** plugin the `src` is left empty at this point and filled in
   asynchronously, once the main process reports the loopback URL over
   `plugins:serve-folder`. The section and the registry entry are still created
   synchronously, because the shell snapshots both; only the URL arrives late.
   A plugin whose server fails to start shows the reason inside its own frame
   rather than breaking the boot.

3. **Pushes an app entry into `APP_REGISTRY`** with `id: plugin-<id>`,
   `viewId: plugin-<id>-view`, the name/description, a plug icon, and
   `placement: 'more'`.

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
  [`register-data-ipc.js`](../../src/main/ipc/register-data-ipc.js), wrapping
  [`inspect-plugin-folder.js`](../../src/main/lib/inspect-plugin-folder.js)
- Preload: `window.hikariApi.inspectPluginFolder(path)` in
  [`system-api.js`](../../src/main/preload/api/system-api.js)

On success it returns `{ ok: true, id, name, version, description,
permissions, path, entryUrl, embedUrl, serve }` — exactly the record Settings
stores, plus `enabled: true`. The directory picker reuses
`storage:pick-directory`.

### 4.4 Serving a plugin folder

For `serve: true` plugins the renderer calls
`window.hikariApi.servePluginFolder(id, path)` (channel
`plugins:serve-folder`), which asks the main-process registry in
[`plugin-server.js`](../../src/main/lib/plugin-server.js) to start — or reuse —
a loopback server rooted at that folder, and returns its base URL. The
renderer re-validates that URL with `isSameOriginSafeUrl()` before assigning it
as the frame `src`, so a compromised reply cannot widen the sandbox. Server
constraints are in §5.2.

### 4.3 Settings panel

- Markup: `data-settings-panel="plugins"` in
  [`ui/html/views/setting-view.html`](../../ui/html/views/setting-view.html)
  (`index.html` is generated — edit the fragment, then `npm run build:ui`).
- Elements resolved in [`settings/dom.js`](../../src/renderer/modules/settings/dom.js).
- Logic in
  [`settings/plugins-controller.js`](../../src/renderer/modules/settings/plugins-controller.js).

---

## 5. Security model

Plugins are untrusted third-party code and run with the least privilege the
platform offers.

- **Sandboxed iframe.** Local plugins get `sandbox="allow-scripts allow-forms
  allow-modals allow-popups"` and deliberately **no** `allow-same-origin`, so
  the plugin is an opaque origin: no host DOM, no host `localStorage` (where
  app state lives), no cookies.
- **No Node, no preload bridge.** The renderer runs with
  `contextIsolation: true` / `nodeIntegration: false`, and Electron preload
  scripts do not run in subframes, so plugins never see `window.hikariApi`.
- **The host API is the only channel in, and it is narrow.** Every request
  crosses `postMessage` and is checked against the *frame identity*, not
  against anything in the payload — a plugin cannot claim another plugin's id
  to borrow its permissions. Handlers copy and clamp the fields they return
  rather than handing back live state objects.
- **Grants are frozen at install time.** Editing `permissions` in an installed
  plugin's manifest has no effect until the user re-adds it (§3).

### 5.1 Why served and remote plugins may use `allow-same-origin`

Served and remote frames carry `allow-same-origin`, which on a local plugin
would be catastrophic — a `file://` frame would inherit the host's own origin
and could read the host document and its `localStorage`. It is safe for the
other two for one reason: **their `src` is a real origin of its own, so the
flag grants them *that* origin rather than Hikari's.**

- Remote: the embedded site's https origin.
- Served: `http://127.0.0.1:<random port>`. The host runs from `file://`, and
  a distinct port is a distinct origin, so they never coincide. Each served
  plugin gets its **own** port too, so plugins cannot read each other's
  storage either.

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

The flag is gated on an **origin check, not a manifest field**:
`isSameOriginSafeUrl()` in
[`plugin-loader.js`](../../src/renderer/app/plugin-loader.js) decides the
sandbox string at mount time and accepts only https or loopback http;
`inspectPluginFolder` rejects a non-https `embed` at install; and
`normalizePluginEntries` strips a non-https `embedUrl` on load. A hand-edited
settings file cannot walk a `file://` URL into a same-origin frame. All three
layers are covered by tests (§9).

### 5.5 The CSP has to admit the plugin's origin

A served plugin's frame loads from `http://127.0.0.1:<random port>`, and the
app's own Content-Security-Policy decides whether that is allowed at all. The
`frame-src` directive in
[`ui/html/shell/start.html`](../../ui/html/shell/start.html) therefore reads:

```
frame-src 'self' blob: http://127.0.0.1:* http://[::1]:*;
```

Without the loopback entries the browser blocks the frame outright and a served
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

### 5.2 The plugin server

Served plugins are delivered by
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

Servers start lazily when a served plugin mounts, are reused across renderer
reloads, and die with the app.

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

### 5.4 Opaque origins cannot load ES modules

A side effect of the opaque-origin sandbox worth knowing when you write a
**local** or **service** plugin: a `null`-origin document cannot fetch a
relative ES module. `<script type="module" src="./main.js">` (or any inline
module with a relative `import`) is silently CORS-blocked, so the script never
runs and the plugin does nothing — no error in the host console.

Use **classic scripts** in local and service plugins:

```html
<script src="./hikari.js"></script>       <!-- defines window.HikariPlugin -->
<script src="./parse-results.js"></script><!-- defines a plugin-owned global -->
<script src="./main.js"></script>         <!-- uses both globals -->
```

Served and remote plugins have a real origin and are unaffected — modules work
there. The copyable `hikari.js` client itself is a classic script and works in
both local and served plugins. This was verified directly: the same service
page fails to run as a module in an opaque frame and succeeds as classic
scripts.

---

## 6. Limitations

- **Reload to apply.** Add/enable/disable/remove all require an app reload.
- **Metadata is snapshotted** (§3), deliberately.
- **Host API is read-mostly.** One verb writes to the user's records,
  `notebook.appendResult`, and it can only append to entries they already
  created. A plugin's own data goes in its storage blob (§3.1).
- **No custom icon.** Plugins always use the built-in plug icon and "More"
  placement (`PLUGIN_ICON_MARKUP` in `plugin-loader.js`). Supporting a manifest
  icon means reading and sanitizing an SVG in `inspectPluginFolder`.
- **No host chrome inside the view** (§4.1). The frame is the whole pane, so
  a plugin draws its own rail, toolbar, and navigation — and gets no way to put
  anything in the app's chrome. If a plugin ever needs to contribute to it, the
  path is a bridge verb the host renders, not the frame reaching into host DOM.
- **No inter-plugin communication**, and no background execution — a plugin
  only runs while its view exists.
- **Persistence is the host's, not the platform's.** The sandbox denies
  `localStorage` to opaque origins, so a plugin that needs to remember anything
  uses the `storage` verbs (§3.1) and lives within their cap. Larger artifacts
  use the plugin-scoped `files` verbs (§3.2).

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Plugin folder does not contain plugin.json.` | The manifest is required now. See §1.1 for the minimum. |
| `Plugin folder must be named "X" to match the manifest id` | Rename the folder to the `id`, or change the `id` to the folder name. |
| `plugin.json needs a "version" like "1.0.0"` | Three numeric parts. `"1.0"` and `"v1.0.0"` are rejected. |
| `Unknown permission "…"` | Typo, or a capability that does not exist. Allowed names are in §1.2. |
| Plugin added but not in navigation | Reload the app (Settings → Plugins → Reload App). |
| Blank local plugin view using `type="module"` | Local frames have an opaque origin and cannot fetch relative ES modules. Load classic scripts in dependency order (§5.4), or opt into `serve: true` when modules are necessary. |
| Blank plugin view | Open DevTools; the page failed like any webpage would (bad script path, JS error). Paths inside the plugin must be relative. Add an in-frame loading/error state so users see the failure too. |
| `…did not declare the "X" permission in plugin.json` | Add it to `permissions`, then **remove and re-add** the plugin — grants are snapshotted. |
| Host calls time out | The frame is not registered: the plugin is disabled, or the page is open outside Hikari (e.g. straight in a browser). |
| `localStorage` throws | Expected; the sandbox denies storage to opaque origins. |
| The UI says “saved,” but data is missing | Only show success after every awaited API call resolves. `storage.set` rejects a missing `value`, and `files.write` rejects invalid base64 or a downstream disk failure. |

---

## 8. Graduating a plugin into a built-in module

Iframe plugins are deliberately bounded: fixed icon, "More" placement, no host
UI, no agent integration, and only the API verbs in
[plugin-api.md](plugin-api.md). When an extension needs a dock icon, the shared
left-rail layout, agent MCP tools, or its own skill, it graduates from a plugin
folder to a **first-class module** wired into the codebase. The general recipe
is [docs/module-development/](../module-development/README.md); the four
integration points specific to graduating are below.

### 8.1 Dock bar icon and placement

Built-in apps get their icon and position from
[`ui/config/app-registry.json`](../../ui/config/app-registry.json):

1. **Draw the icon.** Save an SVG at `assets/icons/<my-feature>.svg`:
   `viewBox="0 0 24 24"`, `stroke="currentColor"`, `fill="none"`, stroke width
   ≈ 1.75, round caps/joins. `currentColor` is required so the icon follows
   active/hover tinting.
2. **Reference it** as `"icon": "my-feature.svg"`. `npm run build:ui` inlines
   it as `iconMarkup` in `app-registry.generated.js` — never edit the generated
   file.
3. **Choose placement.** `"placement": "dock"` plus an entry in `dockOrder`
   (same file, array order = dock position) pins the app to the dock. Apps not
   in `dockOrder` land in "More". The dock is responsive — trailing apps
   overflow into "More" when the window is narrow
   ([`navigation-shell.js`](../../src/renderer/app/navigation-shell.js)
   `getDockCapacity()`) — so dock placement is a preference, not a guarantee.

### 8.2 Using the shared left rail

Most built-in workspaces use the two-pane layout from
[`left-rail-template.css`](../../ui/css/overrides/left-rail-template.css):

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

- `left-rail-template` / `__rail` / `__main` — grid layout, borders, scrolling.
- `data-sync-left-rail` — opts into the shared, draggable, persisted rail width
  driven by
  [`shared-left-rail.js`](../../src/renderer/app/shared-left-rail.js)
  (CSS vars `--shared-left-rail-width/min/max`). Participating views resize
  together.
- The shell toggles `body.has-shared-left-rail-view` when the active view shows
  a synced rail, aligning the surrounding chrome.

Details and CSS-layer ordering:
[module-development/02-html-and-css.md](../module-development/02-html-and-css.md).

Plugin views get none of this from the host — a plugin that wants the shape
copies the markup and CSS into its own page. See §4.1.

### 8.3 Registering MCP tools

Agent-facing tools live in the provider-neutral contract at
`src/main/agent/mcp-contract/`. To register a direct tool:

1. **Create** `direct-tools/<my-tool>.js`, modeled on
   [`ask-user.js`](../../src/main/agent/mcp-contract/direct-tools/ask-user.js):

   ```js
   const MY_TOOL_MCP_TOOL = Object.freeze({
     name: 'my_tool',                       // snake_case, stable
     description: 'One sentence on when the agent should call this.',
     annotations: buildReadOnlyToolAnnotations('My tool'), // or buildWriteToolAnnotations
     inputSchema: { type: 'object', additionalProperties: false /* … */ }
   });

   async function callMyTool(args, context, deps) {
     // validate args, do the work, return a structured result
   }
   ```

2. **Register** in
   [`direct-tools/index.js`](../../src/main/agent/mcp-contract/direct-tools/index.js):
   append `{ definition: MY_TOOL_MCP_TOOL, handler: callMyTool }` to
   `DIRECT_MCP_TOOLS`. The stdio MCP server, tool router, and definition
   listing all read that array.
3. **Expose to Codex** in
   [`instructions.js`](../../src/main/agent/mcp-contract/instructions.js): add
   `'my_tool'` to `HIKARI_MCP_TOOL_NAMES` (this becomes `enabled_tools` in the
   Codex `config.toml` written by `codex-agent/runtime-files.js`) and add a
   `` `${toolName('my_tool')}`: … `` bullet to
   `buildHikariAgentMcpInstructionBodyLines()`.
4. **Keep [mcp-contract.md](../agent/mcp-contract/mcp-contract.md) in sync.**

Two shortcuts: tools already in the app tool catalog can be bridged via
[`generic-app-tool.js`](../../src/main/agent/mcp-contract/direct-tools/generic-app-tool.js)
instead of a hand-written definition; and a module can own a whole tool *group*
in its own tree and spread it into the registry — the papers module does this
with `PAPER_INTAKE_DIRECT_MCP_TOOLS` from
`src/main/papers/store/intake/mcp-tools.js`, the pattern to copy.

### 8.4 Module-owned skills

A skill is a `SKILL.md` (YAML frontmatter + markdown body) teaching the agent
when and how to use a capability.

**Official (module-owned) skills** ship with the app in `OFFICIAL_MCP_SKILLS`
in
[`official-mcp-skills.js`](../../src/main/agent/codex-agent/official-mcp-skills.js):

1. Append an entry with a unique `id`, a `directory` (convention:
   `hikari-<name>`), and `content` from
   `buildSkillMarkdown({ id, name, description, body })`. Reference your MCP
   tools via `buildHikariMcpToolName('my_tool')`.
2. That's it — at agent startup and on storage-root sync the app releases every
   official skill into `<workspace>/.agents/skills/<directory>/SKILL.md`
   (`releaseOfficialMcpSkillsForWorkspace`). Release is idempotent: each
   generated file carries a `HIKARI_OFFICIAL_MCP_SKILL:<id>` marker, and a file
   *without* the marker (hand-edited by the user) is preserved, never
   overwritten.

The `paper-intake` skill is the reference example — the papers module owns both
the MCP tools (§8.3) and the skill instructing the agent to run them.

**External skills** are user-provided: any `<folder>/SKILL.md` under
`~/.hikari/skills`, `~/.agents/skills`, `<workspace>/.agents/skills`, or
`<workspace>/skills`, discovered at runtime by
[`agent-skill-runtime.js`](../../src/main/agent/skills/agent-skill-runtime.js)
and toggled in **Settings → External Skills**. Frontmatter (all optional except
`name`/`description`):

| Field | Meaning |
| --- | --- |
| `name`, `description` | Identity and the trigger text shown to the agent. |
| `user-invocable` | Expose as a `/command` (default `true`). |
| `disable-model-invocation` | Command-only; hidden from agent prompts. |
| `command-dispatch: tool` + `command-tool` | Make the command call a tool directly instead of prompting. |
| `command-arg-mode` | How command arguments are passed (default `raw`). |
| `metadata: {"openclaw": {"requires": {…}, "os": [...], "always": true}}` | Eligibility gates: required binaries/env/config, OS filter, always-on. |

See [`skills/command-line/SKILL.md`](../../skills/command-line/SKILL.md) for a
working example.

Rule of thumb: if the skill documents a capability your module ships, put it in
`OFFICIAL_MCP_SKILLS` so it deploys and stays consistent with the code; use
external skill folders only for user- or site-specific additions.

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
  runs the gel plugin's own copy of the analysis pipeline and checks its folder
  contract. The gel UI suites in `tests/suites/edge/bio-tools-and-gel-suite/`
  run against that same copy, since it is the only one left.
- `a plugin view is its frame, with no host chrome around it` — drives
  `installPlugins` against a minimal fake DOM and asserts each plugin view has
  no host rail and no rail template, one frame filling one pane, and the
  plugin's kind and host access on the frame's `title`/`aria-label`.
- Service plugins have their own suite — see
  [service-plugins.md §7](service-plugins.md#7-testing).

The core contracts live in [`test.js`](../../test.js); copyable-client and Gel
folder checks live in [`tests/`](../../tests/). For manual end-to-end checks, install
[`examples/plugins/notebook-results/`](../../examples/plugins/notebook-results/)
for the host API and [`examples/plugins/imagej/`](../../examples/plugins/imagej/)
for a served plugin, then follow
[imagej-walkthrough.md](imagej-walkthrough.md).
