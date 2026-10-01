# Hikari Plugin System

A plugin is a folder of web files that Hikari boots as a first-class app: it
gets a navigation entry, its own workspace view, and — if its manifest asks for
it — a narrow set of permission-gated host capabilities.

New plugin author? Start with the copyable
[**quickstart.md**](quickstart.md), then use this page for the complete folder
contract and lifecycle. Also see:

- [**plugin-api.md**](plugin-api.md) — the host API reference (every verb,
  its permission, its exact request/response shape).
- [**imagej-walkthrough.md**](imagej-walkthrough.md) — a case study of a
  plugin with a heavy runtime (ImageJ in WebAssembly): why it needs a real
  origin with storage, and what "runs locally" does and does not cover.
- [**service-plugins.md**](service-plugins.md) — headless plugins that add a
  capability, such as a file-format converter, to a built-in feature.

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
| Example | [`hello-world`](../../examples/plugins/hello-world/), [`notebook-results`](../../examples/plugins/notebook-results/) | [`src/plugins/gel`](../../src/plugins/gel/) (bundled) | — | none in the repo; see [service-plugins.md](service-plugins.md) |

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
| `serve` | boolean | no | Legacy explicit opt-in to loopback delivery; local folders now receive this automatically. Rejected alongside `embed`. |
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
| `python` | Run Python in the host's sandbox — a throwaway directory per run, deleted when it ends ([plugin-api.md `python.run`](plugin-api.md#pythonrun--python)). This is the one permission that executes code outside the frame; grant it deliberately. |
| `notifications` | Ask Hikari to show an attributed, transient success or error toast ([plugin-api.md `notifications.show`](plugin-api.md#notificationsshow--notifications)). Grants no control over markup, placement, actions, or persistence. |
| `agent:chat` | Submit prompts to the plugin's independent Agent Chat rail. |
| `agent:canvas` | Receive `plugin_canvas` requests through `agent.canvas` and acknowledge with `agent.respond`. The plugin owns its scene contract. |
| `layout` | Commit the shared left-rail width used by plugin and built-in workspaces ([plugin-api.md `app.setLeftRailWidth`](plugin-api.md#appsetleftrailwidth--layout)). |

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

1. **Settings** (gear app) → **Skills & plugins** → **Plugins**.
2. **Add Plugin Folder**, pick the folder. It is validated against §1 on the
   spot; a rejected folder shows the exact reason in the status line.
3. The plugin is saved as *enabled*. Click **Reload App** to boot it.
4. After reload it appears in the "More" menu with Hikari's generic plug icon
   and takes part in topbar search and startup-view logic like any built-in app.

Each row shows name, version, description, **declared host access**, and folder
path, plus an On/Off toggle and a **Remove** button. Removing forgets the
settings entry; the folder on disk is never touched.

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
  "path": "/Users/me/plugins/notebook-results",
  "entryUrl": "file:///Users/me/plugins/notebook-results/index.html",
  "enabled": true
}
```

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
`<storage root>/Plugins/<plugin id>/`, addressed with `files.write` /
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
   Installable plugins receive the generic plug icon. An internal bundled
   definition may provide trusted `iconMarkup`, such as Gel's electrophoresis
   mark; manifest-provided host markup is never accepted.

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

For all local/served view plugins and service plugins the renderer calls
`window.hikariApi.servePluginFolder(id, path)` (channel
`plugins:serve-folder`), which asks the main-process registry in
[`plugin-server.js`](../../src/main/lib/plugin-server.js) to start — or reuse —
a loopback server rooted at that folder, and returns its base URL. The
renderer requires a loopback origin via `pluginOrigin()` before assigning it
as the frame `src`, so a compromised reply cannot widen the sandbox. Server
constraints are in §5.2.

### 4.3 Settings panel

- Markup: the **Plugins** block inside `data-settings-panel="skills"` (**Skills & plugins**) in
  [`ui/html/views/setting-view.html`](../../ui/html/views/setting-view.html)
  (`index.html` is generated — edit the fragment, then `npm run build:ui`).
- Elements resolved in [`settings/dom.js`](../../src/renderer/modules/settings/dom.js).
- Logic in
  [`settings/plugins-controller.js`](../../src/renderer/modules/settings/plugins-controller.js).

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

---

## 6. Limitations

- **Reload to apply.** Add/enable/disable/remove all require an app reload.
- **Metadata is snapshotted** (§3), deliberately.
- **Host API is read-mostly.** One verb writes to the user's records,
  `notebook.appendResult`, and it can only append to entries they already
  created. A plugin's own data goes in its storage blob (§3.1).
- **No installable custom icon.** User-installed plugins always use the built-in
  plug icon and "More" placement (`PLUGIN_ICON_MARKUP` in `plugin-loader.js`).
  Source-owned internal definitions may provide audited icon markup; accepting
  SVG from an installable manifest would require a separate sanitizer.
- **No host chrome inside the view** (§4.1). The frame is the whole pane, so
  a plugin draws its own rail, toolbar, and navigation. It can synchronize a
  rail's width through the safe layout context, but gets no way to put anything
  in the app's chrome. If a plugin ever needs to contribute to it, the path is
  a bridge verb the host renders, not the frame reaching into host DOM.
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
| `Unknown permission "…"` | Typo, or a capability that does not exist. Allowed names are in §1.2. |
| Plugin added but not in navigation | Reload the app (Settings → Skills & plugins → Reload App). |
| Local scripts fail to load | Reload with the current app version and check that the plugin folder still exists. All local assets now load from loopback (§5.4). |
| Blank plugin view | Open DevTools; the page failed like any webpage would (bad script path, JS error). Paths inside the plugin must be relative. Add an in-frame loading/error state so users see the failure too. |
| `…did not declare the "X" permission in plugin.json` | Add it to `permissions`, then **remove and re-add** the plugin — grants are snapshotted. |
| Host calls time out | The frame is not registered: the plugin is disabled, or the page is open outside Hikari (e.g. straight in a browser). |
| `localStorage` / `IndexedDB` empty after an app restart | Expected. A recycled loopback port would otherwise hand you another plugin's storage, so each run starts the origin empty (§5.1). Use `storage` and `files` for durable data. |
| The UI says “saved,” but data is missing | Only show success after every awaited API call resolves. `storage.set` rejects a missing `value`, and `files.write` rejects invalid base64 or a downstream disk failure. |

---

## 8. Graduating a plugin into a built-in module

Iframe plugins are deliberately bounded: no host DOM, no agent integration,
and only the API verbs in [plugin-api.md](plugin-api.md). Installable plugins
use Hikari's generic plug icon because inserting manifest-provided SVG into the
host document would be unsafe. Source-owned internal plugins may carry a
trusted icon in their bundled definition. A plugin that draws its own left rail
can synchronize its width through `app.info`, `app.context`, and
`app.setLeftRailWidth`, but the rail and resize interaction still live inside
the iframe.

When an extension needs host-owned navigation order and chrome, direct module
integration, agent MCP tools, or its own skill, it graduates from a plugin
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

Plugin views do not receive host DOM or this controller. A plugin that wants the
shape copies the markup and CSS into its own page, reads
`app.info.layout.leftRail`, and commits the settled drag width through
`app.setLeftRailWidth`. The bundled Gel plugin is the complete internal
reference. See §4.1 and [plugin-api.md §3](plugin-api.md#3-write-verbs).

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
   add a `['./my-tool.js', 'MY_TOOL_MCP_TOOL', 'callMyTool']` row to the load
   table. `loadDirectMcpTools()` requires each module on its own, so a tool
   that fails to load is reported and skipped instead of taking the server
   down. The stdio MCP server, tool router, and definition listing all read the
   resulting `DIRECT_MCP_TOOLS`.
3. **Expose to Codex** in
   [`instructions.js`](../../src/main/agent/mcp-contract/instructions.js): add
   `'my_tool'` to `HIKARI_MCP_TOOL_NAMES` (this becomes `enabled_tools` in the
   Codex `config.toml` written by `codex-agent/runtime-files.js`) and add a
   `` `${toolName('my_tool')}`: … `` bullet to
   `buildHikariAgentMcpInstructionBodyLines()`.
4. **Keep [mcp-contract.md](../agent/mcp-contract/mcp-contract.md) and
   `mcp-contract.json` in sync.** Tests compare several snapshot entries with
   the live definitions.

New tools appear in **Settings > Tool access** automatically (the list is
`HIKARI_MCP_TOOL_NAMES`), and a switched-off tool is left out of
`enabled_tools`.

Two shortcuts: tools already in the app tool catalog can be bridged via
[`generic-app-tool.js`](../../src/main/agent/mcp-contract/direct-tools/generic-app-tool.js)
instead of a hand-written definition; and a module can own its tools
in its own tree and point the load table at them — the papers module does this
with the four files in `src/main/papers/store/intake/mcp/`, and the Sequence
Viewer exports a whole group (`SEQUENCE_MCP_TOOLS`) through
`direct-tools/sequence-tools.js`. Those are the patterns to copy.

### 8.4 Module-owned skills

A skill is a `SKILL.md` (YAML frontmatter + markdown body) teaching the agent
when and how to use a capability.

**Official (module-owned) skills** ship with the app as folders under
[`src/main/agent/codex-agent/official-skills/`](../../src/main/agent/codex-agent/official-skills/),
read at startup by
[`official-mcp-skills.js`](../../src/main/agent/codex-agent/official-mcp-skills.js)
into `OFFICIAL_MCP_SKILLS`:

1. Add `official-skills/hikari-<name>/SKILL.md` with `name`/`description`
   frontmatter and a `<!-- HIKARI_OFFICIAL_MCP_SKILL:<name> -->` marker line.
   Put long material in files beside it (for example `references/*.md`) and
   link them from `SKILL.md`; they are released with it.
2. If the skill depends on MCP tools, list them under its id in
   `OFFICIAL_MCP_SKILL_TOOL_REQUIREMENTS`. When any of them is switched off in
   **Settings > Tool access**, the skill is withdrawn from the workspace.
3. That's it — at agent startup and on every storage-root save the app releases
   each enabled official skill into
   `<workspace>/.agents/skills/<directory>/SKILL.md` for the storage root and
   each project folder (`releaseOfficialMcpSkillsForWorkspace`). Release is
   idempotent: a file carrying the marker is Hikari's to update or withdraw, and
   a file *without* it (hand-edited by the user) is preserved, never
   overwritten.

`hikari-paper-retrieval` and `hikari-sequence-viewer` are reference examples —
their modules own both the MCP tools (§8.3) and the skill instructing the
agent to use them.

**External skills** are user-provided: any `<folder>/SKILL.md` under
`~/.hikari/skills`, `~/.agents/skills`, `<workspace>/.agents/skills`, or
`<workspace>/skills`, discovered at runtime by
[`agent-skill-runtime.js`](../../src/main/agent/skills/agent-skill-runtime.js)
and toggled in **Settings → Skills & plugins**. Frontmatter (all optional except
`name`/`description`):

| Field | Meaning |
| --- | --- |
| `name`, `description` | Identity and the trigger text shown to the agent. |
| `user-invocable` | Expose as a `/command` (default `true`). |
| `disable-model-invocation` | Command-only; hidden from agent prompts. |
| `command-dispatch: tool` + `command-tool` | Make the command call a tool directly instead of prompting. |
| `command-arg-mode` | How command arguments are passed (default `raw`). |
| `metadata: {"openclaw": {"requires": {…}, "os": [...], "always": true}}` | Eligibility gates: required binaries/env/config, OS filter, always-on. |

The official skills under `official-skills/` show the `name`/`description`
frontmatter and body layout; external skills use the same format.

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
  runs the internal Gel plugin's own analysis pipeline and checks its manifest,
  bundled definition, and source-owned folder contract. The Gel UI suites in
  `tests/suites/edge/bio-tools-and-gel-suite/` run against that same copy, since
  it is the only implementation.
- `a plugin view is its frame, with no host chrome around it` — drives
  `installPlugins` against a minimal fake DOM and asserts each plugin view has
  no host rail and no rail template, one frame filling one pane, and the
  plugin's kind and host access on the frame's `title`/`aria-label`.
- Service plugins have their own suite — see
  [service-plugins.md §7](service-plugins.md#7-testing).

The core contracts live in `tests/suites/core/plugin-system-suite/` (registered
through [`test.js`](../../test.js)); copyable-client and Gel folder checks live in
[`tests/`](../../tests/). For manual end-to-end checks, install
[`examples/plugins/notebook-results/`](../../examples/plugins/notebook-results/)
for the host API, and open the bundled Gel plugin for a production-sized served
plugin.

`node tests/plugin-boundaries-selfcheck.mjs` covers origin revocation, service
message routing, notebook fields, storage rollback, real filesystem symlinks,
server replacement, and that no origin is served before it has been emptied. It
needs loopback networking.

`node node_modules/electron/cli.js tests/plugin-runtime-electron.cjs` runs a
hidden Electron window with a temporary profile and the real preload. It checks
local asset loading, host isolation, navigation grants, loopback-origin
clearing, file IPC, notebook and storage persistence, and headless conversion
without opening user data.
