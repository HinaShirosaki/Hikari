# Hikari Plugin Host API

The host API is how a sandboxed plugin reads and writes Hikari data, fits into
Hikari's shell, and works with the agent. It uses a `postMessage`
request/response protocol plus a small host-event channel between the plugin's
iframe and the host page. The dispatcher is
[`src/renderer/app/plugin-bridge.js`](../../src/renderer/app/plugin-bridge.js);
the verbs are defined in
[`plugin-bridge/verbs.js`](../../src/renderer/app/plugin-bridge/verbs.js) and
[`plugin-bridge/layout-verbs.js`](../../src/renderer/app/plugin-bridge/layout-verbs.js).

Start with [quickstart.md](quickstart.md) for a copyable plugin. Use
[plugin-system.md](plugin-system.md) for the complete folder contract and how
`permissions` are declared and frozen.

**Local and served plugins only.** A remote plugin (one with `embed` in its
manifest) cannot hold permissions and its frame is never registered with the
bridge, so none of this applies to it — the API is absent there, not merely
denied. See [plugin-system.md §1.0](plugin-system.md#10-four-kinds-of-plugin).

## At a glance

| Verb or event | Permission | What it does | See |
| --- | --- | --- | --- |
| `app.info` | — | Handshake: plugin id, granted permissions, appearance, storage, and layout context | [§2](#2-read-verbs) |
| `app.context` event | — | Appearance, storage, or layout changed | [§2](#2-read-verbs) |
| `protocols.list`, `protocols.get` | `protocols:read` | Protocol summaries; one protocol in full | [§2](#2-read-verbs) |
| `projects.list` | `projects:read` | Project ids and names | [§2](#2-read-verbs) |
| `samples.list` | `samples:read` | Sample ids, names, and types | [§2](#2-read-verbs) |
| `notebook.list`, `notebook.get` | `notebook:read` | Notebook summaries; one entry in full | [§2](#2-read-verbs) |
| `storage.get`, `storage.set` | `storage` | The plugin's own JSON blob | [§2](#2-read-verbs), [§3](#3-write-verbs) |
| `notifications.show` | `notifications` | An attributed, transient toast | [§3](#3-write-verbs) |
| `app.setUnsaved`, `app.save` event | — | Join the quit guard for unsaved work | [§3](#3-write-verbs) |
| `app.setHistory`, `app.undo` / `app.redo` events | — | Drive Hikari's undo and redo buttons | [§3](#3-write-verbs) |
| `files.write`, `files.read` | `files` | Files in the plugin's own storage folder | [§3](#3-write-verbs) |
| `downloads.save` | `downloads` | Export bytes through a native save dialog | [§3](#3-write-verbs) |
| `python.run` | `python` | Run Python in a throwaway sandbox | [§3](#3-write-verbs) |
| `notebook.appendResult` | `notebook:write` | Append text or a table to an existing notebook entry | [§3](#3-write-verbs) |
| `app.setLeftRailWidth`, `app.setLeftRailFolded` | `layout` | The shared left-rail width; this plugin's fold state | [§4](#4-layout-and-host-ui-verbs) |
| `app.setWorkspaceTools`, `app.workspaceTool` event | `layout` | Buttons in Hikari's right toolbar | [§4](#4-layout-and-host-ui-verbs) |
| `app.setContextActions`, `app.contextAction` event, `app.readContextAction`, `app.respondContextAction` | `layout` | Actions in the Protocol `…` menu and the PDF selection toolbar, with a one-shot handoff of the selected source | [§4](#4-layout-and-host-ui-verbs) |
| `agent.chat`, `agent.setContext`, `app.setAgentChatExpanded` | `agent:chat` | Submit to, scope, and open or fold the plugin's chat rail | [§5](#5-agent-verbs) |
| `agent.canvas` event, `agent.respond` | `agent:canvas` | Serve the agent's `plugin_canvas` requests | [§5](#5-agent-verbs) |

Verbs reserved for the bundled Gel plugin are not part of this API; see
[`src/plugins/README.md`](../../src/plugins/README.md).

---

## 1. The client

Copy [`examples/plugins/notebook-results/hikari.js`](../../examples/plugins/notebook-results/hikari.js)
into your plugin folder. It wraps the raw protocol in promises:

```html
<script src="./hikari.js"></script>
<script src="./main.js"></script>
```

```js
const { hikari } = window.HikariPlugin;

const entries = await hikari.call('notebook.list');
await hikari.call('notebook.appendResult', { entryId: entries[0].id, text: 'done' });
```

The client remains a classic script and works in all local and served plugins.
Both kinds now use loopback delivery and may also load relative ES modules; see
[plugin-system.md §5.4](plugin-system.md#54-loading-local-scripts).

`hikari.call(verb, params)` resolves with the verb's result or rejects with an
`Error` carrying the host's message. Calls time out after 10 s — the host
stays silent for unregistered frames (§6), so without a timeout a call from a
disabled plugin, or from the page opened directly in a browser, would hang
forever. The client rejects immediately for an empty verb, non-object params,
an unavailable parent frame, or a value that `postMessage` cannot clone.

The 10 s budget is for "nobody is listening", which is answered in
milliseconds or never. Verbs that wait on a person, on megabytes of disk I/O,
or on a subprocess get 10 minutes instead — `downloads.save`, `files.write`,
`files.read`, and `python.run`. There is no cancel message, so a client that
gave up early would report failure for work the host goes on to finish.

`hikari.on(event, listener)` subscribes to host events and returns an
unsubscribe function. The events are `app.context` (§2.1), `app.save` (§3.1),
`app.undo` / `app.redo` (§3.2), `app.workspaceTool` (§4.1),
`app.contextAction` (§4.2), and `agent.canvas` (§5.1). `app.context` and
`app.save` go to every registered frame, undo and redo to the focused frame,
and the rest only to the frame that registered the tool or action, or that
holds `agent:canvas`.

### 1.1 The raw protocol

If you would rather not use the client, the wire format is:

```js
// plugin -> host  (always to window.parent, targetOrigin '*')
{ hikari: 1, id: "<your correlation id>", verb: "notebook.list", params: {} }

// host -> plugin
{ hikari: 1, id: "<same id>", ok: true,  result: <json> }
{ hikari: 1, id: "<same id>", ok: false, error: "<message>" }

// host -> plugin event
{ hikari: 1, event: "app.context", payload: <json> }
```

`hikari: 1` is the protocol marker; messages without it are ignored in both
directions, so the channel coexists with any other `postMessage` traffic on the
page. `id` is opaque to the host and echoed back verbatim — generate whatever
you like, but make it unique per in-flight call.

Replies and host events target the plugin's assigned loopback origin explicitly.
Access control checks both `event.source` and `event.origin`; a message from a
replacement origin revokes the frame grant. An in-flight reply cannot be
delivered to another origin after navigation.

---

## 2. Read verbs

### `app.info` — *no permission required*

Handshake and self-inspection. Use it to confirm the plugin is running inside
Hikari and to see what it was actually granted.

```js
await hikari.call('app.info');
// {
//   host: 'hikari',
//   pluginId: 'notebook-results',
//   permissions: ['notebook:read', 'notebook:write'],
//   appearance: { mode: 'day', fontSize: 16 },
//   storage: { configured: true },
//   layout: {
//     leftRail: { width: 280, min: 240, max: 400, mobileBreakpoint: 980, foldable: true, folded: false },
//     agentChatRail: { expanded: false, available: true },
//     workspaceTools: { available: true, icons: ['pointer', 'lasso', /* … */ 'crop', 'fit'] }
//   }
// }
```

The storage value is deliberately a boolean. It lets a plugin disable file
actions without revealing the user's storage path.

`layout.leftRail` is safe presentation context for plugins that draw their own
two-pane workspace. It reports the host's current persisted rail width and
clamping limits. `foldable` indicates that the host supports folding; `folded`
is the saved preference for the calling plugin's rail. Folding is independent
per plugin, while expanded widths stay shared. This context exposes no host DOM.
`layout.agentChatRail.expanded` reports whether the host's chat rail is open
for the active workspace. Opening, folding or navigating between workspaces
publishes an `app.context` event with `changed:"layout"`. Plugins can use this
to hide a redundant composer while keeping figure controls visible.
`layout.agentChatRail.available` is `false` while Codex is not connected in
Settings; the host then hides its chat and AI actions, and `agent.chat` returns
`{ok:false,reason:"unavailable"}`, so hide any prompt UI too. Connecting or
disconnecting publishes the same `changed:"layout"` event.
`layout.workspaceTools.available` is `true` when the host has the shared right
toolbar used by `app.setWorkspaceTools` (§4). `layout.workspaceTools.icons`
lists the icon names accepted by that host. Older hosts omit this list and
support the icons in §4 except `crop`; use `fit` for Crop on those hosts.

### 2.1 `app.context` event — *no permission required*

The host pushes the same safe `appearance`, `storage`, and `layout` context
when any of them changes. `changed` identifies the part that triggered the
event:

```js
const unsubscribe = hikari.on('app.context', ({ appearance, storage, layout, changed }) => {
  document.body.dataset.appearanceMode = appearance.mode;
  saveButton.disabled = !storage.configured;
  document.documentElement.style.setProperty('--shared-left-rail-width', `${layout.leftRail.width}px`);
});
// payload: { appearance: {...}, storage: {...}, layout: {...}, changed: 'appearance' | 'storage' | 'layout' }
```

Call `app.info` for the initial snapshot; use the event to stay synchronized.
The event does not expose protocols, notebook records, or other mutable app
data.

### `protocols.list` — `protocols:read`

Summaries of all protocols, capped at 500.

```js
// [{ id, name, purpose, updatedAt }, …]
```

### `protocols.get` — `protocols:read`

One protocol in full. Rejects if `id` does not exist.

```js
await hikari.call('protocols.get', { id: 'p_123' });
// {
//   id, name, purpose,
//   materials: [...],          // as stored by the protocol editor
//   steps: [...],              // ordered; each step carries its own id and text
//   troubleshooting: '',
//   createdAt, updatedAt       // ISO 8601
// }
```

`materials` and `steps` are passed through as stored rather than reshaped, so
treat them as loosely typed and read defensively. The protocol editor's
canonical draft shape is in
[`protocol/draft-utils.js`](../../src/renderer/modules/protocol/draft-utils.js).

### `projects.list` — `projects:read`

```js
// [{ id, name }, …]
```

### `samples.list` — `samples:read`

```js
// [{ id, name, type }, …]
```

### `notebook.list` — `notebook:read`

Summaries of all notebook entries, capped at 500.

```js
// [{ id, experimentName, protocolId, projectId, savedAt }, …]
```

### `notebook.get` — `notebook:read`

One entry in full. Rejects if `id` does not exist.

```js
await hikari.call('notebook.get', { id: 'n_123' });
// { id, experimentName, protocolId, projectId, resultText, resultTables, savedAt }
```

### `storage.get` — `storage`

The plugin's own persisted blob, or `null` if it has never written one.

```js
await hikari.call('storage.get');
// { value: { records: [...] } | null, limit: 1000000 }
```

`limit` is the cap `storage.set` enforces, in characters. Read it rather than
hard-coding the number — showing the user how full they are is the difference
between a save that fails and a save they saw coming.

---

## 3. Write verbs

### `notifications.show` — `notifications`

Asks Hikari to show a transient host toast. Use it for a user-relevant success
or recoverable error after an operation finishes, not as a progress log.

```js
await hikari.call('notifications.show', {
  message: 'Export complete.',
  type: 'success',
  durationMs: 5000
});
// { shown: true, type: 'success', durationMs: 5000 }
```

| Param | Type | Notes |
| --- | --- | --- |
| `message` | string | Required, non-empty after trimming, at most 1,000 characters. Rendered as text; HTML is never accepted or interpreted. |
| `type` | string | Optional: `success` (default) or `error`. These are the two states supported by Hikari's shared notification system. |
| `durationMs` | integer | Optional. Defaults to 5,000; allowed range is 1,000–15,000 ms. |

The host prefixes the installed plugin name (for example,
`Plugin My Plugin: Export complete.`), so plugin-generated notices remain visibly
attributed and cannot masquerade as an unlabeled Hikari message. The plugin
cannot choose markup, position, colors, actions, or stacking behavior.

Hikari keeps one shared toast: a newer message replaces the current one. An
identical message repeated while visible does not restart its timer. The toast
uses the host's `role="status"` / `aria-live="polite"` surface and disappears;
it is not stored in history and cannot be used for a confirmation that requires
an answer. Keep durable state in the plugin UI or notebook instead.

A headless service may call this verb if it declares `notifications`; Hikari,
not the hidden service frame, renders the toast. This does not give the service
a view. The `dna-importer` example converter ([service-plugins.md](service-plugins.md)) deliberately does not request
the permission and emits no conversion-progress notification.

### `app.setUnsaved` — *no permission required*

Reports that the frame is holding unsaved work, so a plugin can block the
window close the same way a built-in editor does.

```js
await hikari.call('app.setUnsaved', { unsaved: true });
// { unsaved: true }
```

| Param | Type | Notes |
| --- | --- | --- |
| `unsaved` | boolean | Anything other than `true` clears the flag. |

**Do not reach for `beforeunload` instead.** A subframe that cancels it vetoes
the whole window close in Electron, with no dialog and no error — the red X
simply stops working. Push the flag up and let the host ask.

With the flag set, the host names the plugin (by its manifest `name`) in the
unsaved-changes dialog at quit time and offers to save it. Workspace cloud sync
also refuses to start until the flag clears.

### 3.1 `app.save` event — *no permission required*

```js
hikari.on('app.save', ({ pluginId }) => {
  save().finally(pushUnsavedState);   // push app.setUnsaved either way
});
```

Sent when the user chooses to save at quit time. The protocol has no host->plugin
request, so this is a broadcast and every registered frame receives it — read
`pluginId` if you ship more than one.

There is no reply: the host watches for your next `app.setUnsaved` and treats a
clearing push as "saved". If nothing arrives within 15 s it stops waiting and
reports the plugin as still blocking the quit — so push after a *failed* save
too, rather than staying silent for the full timeout.

### `app.setHistory` — *no permission required*

Reports the frame's own undo/redo depth so the host's global history buttons can
drive it. Nothing here is inferred: the host cannot see inside the frame, so the
plugin volunteers this the same way it volunteers `app.setUnsaved`.

```js
await hikari.call('app.setHistory', { canUndo: true, canRedo: false });
// { canUndo: true, canRedo: false }
```

| Param | Type | Notes |
| --- | --- | --- |
| `canUndo` | boolean | Anything other than `true` is `false`. |
| `canRedo` | boolean | Same. |

The buttons follow focus. The host remembers the last focused plugin frame and
reads the depth *that* frame reported, so a frame the user is not editing in
does not light them up. A plugin's shared workspace toolbar (§4.1) also selects
that editor as the history target; clicking Hikari's system history buttons
keeps that target. Switching views or removing the frame releases the claim.
Plugins can use these system buttons without adding their own undo/redo controls.

### 3.2 `app.undo` / `app.redo` events — *no permission required*

```js
hikari.on('app.undo', () => controller.undo());
hikari.on('app.redo', () => controller.redo());
```

Sent to one frame — the focused one — rather than broadcast. The payload is
empty; the command is the event name.

**You still need your own keyboard handler.** Key events inside a focused frame
never reach the host document, so Cmd/Ctrl+Z is yours to bind. These events only
cover the host's toolbar buttons.

### `storage.set` — `storage`

Replaces the plugin's blob. This is how a plugin keeps records of its own
instead of pushing everything it produces into the notebook.

```js
await hikari.call('storage.set', { value: { records: [record, ...previous] } });
// { bytes: 17240, limit: 1000000 }
```

| Param | Type | Notes |
| --- | --- | --- |
| `value` | any JSON | Required. Replaces the whole blob — read, modify, write back. `null` clears it. |

Omitting `value` is rejected. Clearing is therefore always explicit:
`hikari.call('storage.set', { value: null })`.

Rules that matter:

- **Namespaced by frame identity.** A plugin reads and writes only its own
  slice; there is no key parameter, so there is nothing to pass to reach
  another plugin's data.
- **Capped at `limit` characters of JSON**, and a write over the cap is
  rejected with the size in the error while leaving the previous value intact.
  The cap is not politeness: every plugin's blob rides inside app state, which
  is a single `localStorage` record, so one oversized blob would break *every*
  later save app-wide.
- **JSON only.** The value is round-tripped through `JSON.stringify` before it
  is stored, so a `Map`, `Date`, or `Blob` that survived the structured clone
  does not survive the write. Anything cyclic is refused outright.
- **Removing the plugin in Settings does not erase the blob**, so re-adding a
  plugin finds its records where they were.

The blob is the right place for what the plugin owns — its records, its
settings, its cache. It is the wrong place for what the *user* owns: results
they will look for later belong in the notebook, where the rest of the app can
see them. It is also the wrong place for anything measured in megabytes; that
is what `files.write` is for.

If persisting `storage.set` fails (for example, the app-wide browser storage
quota is exceeded), the previous plugin value is restored before the call
rejects. A rejected deletion also retains the previous value.

### `files.write` / `files.read` — `files`

A folder on disk, under the user's storage root, for data a capped JSON blob
cannot hold — images above all.

```js
const { path } = await hikari.call('files.write', {
  path: 'Gels/run-3/source.png',
  dataBase64: base64Png
});
const { dataBase64 } = await hikari.call('files.read', { path });
```

| Param | Type | Notes |
| --- | --- | --- |
| `path` | string | Required. **Relative**, always. Resolved under the plugin's own folder. |
| `dataBase64` | string | `files.write` only. Required, up to 24 000 000 characters (~18 MB). |

- **The plugin never learns where its folder is.** Every path is relative and
  resolved by the host to `<storage root>/Plugins/<plugin id>/`. Absolute
  paths, `..` segments, drive letters, backslash separators, and null bytes are
  rejected before I/O. Dedicated main-process plugin handlers also reject
  symbolic links in every path component beneath the configured storage root.
- **`files.write` returns the relative path that was written.** Writing the same
  path atomically replaces that file. Store the returned path and read with it.
- **The base64 must be canonical and the host write must succeed.** Invalid
  base64 is rejected before IPC, and disk or permission failures reject the
  promise. Never mark a record saved until this call resolves.
- **A storage folder must be configured.** With none set in Settings, both
  verbs fail with a message saying so rather than writing somewhere else.
- Nothing here lists, deletes, or moves files. Keep your own index of what you
  wrote, in `storage`.

### `downloads.save` — `downloads`

Exports plugin-owned bytes through a native save dialog. The plugin suggests a
file name, but the user chooses the destination; the iframe never receives a
filesystem path and does not need the broad `allow-downloads` sandbox token.

```js
const dataBase64 = btoa('lane,band\n1,1\n');
await hikari.call('downloads.save', {
  fileName: 'gel-bands.csv',
  dataBase64
});
// { saved: true, fileName: 'gel-bands.csv' }
// or { saved: false, canceled: true }
```

| Param | Type | Notes |
| --- | --- | --- |
| `fileName` | string | Suggested name only; sanitized by the host. |
| `dataBase64` | string | Required, up to 24 000 000 characters (~18 MB). |

Cancellation is a successful user choice, not an exception. Write failures are
returned as normal host API errors.

### `python.run` — `python`

Runs Python in the host's sandbox and returns what it printed. Each call gets
its own throwaway directory, which is deleted when the run ends — nothing
persists between calls, so this is for computation, not storage.

```js
const result = await hikari.call('python.run', {
  code: [
    'import pathlib, statistics',
    'values = [float(v) for v in pathlib.Path("bands.csv").read_text().split()]',
    'print(statistics.mean(values))',
    'pathlib.Path("mean.txt").write_text(str(statistics.mean(values)))'
  ].join('\n'),
  files: [{ path: 'bands.csv', content: '1.5\n2.5\n3.5\n' }],
  readbackPaths: ['mean.txt']
});
// { ok: true, status: 'ok', stdout: '2.5\n', stderr: '', exitCode: 0,
//   timedOut: false, error: '', files: [{ path: 'mean.txt', content: '2.5', truncated: false }] }
```

| Param | Type | Notes |
| --- | --- | --- |
| `code` | string | Required, up to 200 000 characters. Runs as `main.py`. |
| `files` | array | Optional input files, up to 32, 4 000 000 characters of content total. Each `{ path, content }`, path **relative**. |
| `readbackPaths` | array | Optional relative paths to read back after the run, up to 20. |
| `timeoutMs` | number | Optional, clamped by the host to 500–15 000 ms. |

- **A failed run is not a rejected promise.** Non-zero exits, timeouts, and
  tracebacks come back as `ok: false` with `stderr` and `status` filled in. The
  promise rejects only for bad params or a host with no Python installed.
- **Paths are relative and confined to the run directory**, the same rule as
  `files.*`. Absolute paths and `..` segments are rejected; the plugin never
  learns where the directory is, and cannot reach its own plugin folder from
  inside a run. Move bytes in through `files` and out through `readbackPaths`.
- **`stdout`/`stderr` are capped at 120 000 characters** and readback content at
  60 000 per file. Print a summary, not a dataset.
- **The host's interpreter path, run id, and pid are not returned.** If you need
  to know whether Python exists at all, make a trivial call and check `ok`.
- **This grant is a subprocess, not a file read.** It is deliberately not
  covered by `files` or `storage`; a plugin must ask for `python` by name and
  the user sees it on the plugin's row in Settings before enabling it.

### `notebook.appendResult` — `notebook:write`

Appends results to an **existing** notebook entry. This is the only verb that
writes to the user's own records.

```js
await hikari.call('notebook.appendResult', {
  entryId: 'n_123',
  text: 'ImageJ: attached 24 measurement rows.',   // optional
  table: {                                          // optional
    title: 'ImageJ measurements',
    columns: [
      { field: 'area', title: 'Area' },
      { field: 'mean', title: 'Mean' }
    ],
    rows: [
      { id: 'row_1', area: '120.5', mean: '88.21' },
      { id: 'row_2', area: '98.0',  mean: '91.44' }
    ]
  }
});
// { id: 'n_123', appendedText: true, appendedTable: true }
```

| Param | Type | Notes |
| --- | --- | --- |
| `entryId` | string | Required. Must match an existing entry. |
| `text` | string | Optional. Appended to the notebook record's `result` after a blank line, preserving the complete existing text. The read API exposes it as `resultText`. |
| `table` | object | Optional. Appended to `resultTables`. |

At least one of `text` / `table` must be present, otherwise the call is
rejected — a no-op write that reports success is worse than an error.

**Table shape.** `columns` is required and must contain at least one entry with
a non-empty `field`; a table with no usable columns is dropped and the call
fails. `field` must be a plain identifier (letters, digits, underscore) — it is
the key each row is read by, so `"Mean Gray"` and `"%Area"` must be sanitized
first (see [`parse-results.js`](../../examples/plugins/notebook-results/parse-results.js) for a worked example, including field-name collisions). Every row should carry an
`id`, and cell values are stored as strings. The table is passed through
`normalizeNotebookResultTable()` from
[`notebook-result-tables.js`](../../src/renderer/lib/notebook-result-tables.js),
the same normalizer the notebook UI uses, so anything it renders is valid here.

After a successful write the host persists state and re-renders the notebook
and its dependent views — the user sees the new rows without reloading.

---

## 4. Layout and host UI verbs

These verbs let a plugin fit into Hikari's shell without touching host DOM. The
plugin keeps its own editor, panels, and state; Hikari renders only what a call
describes — text labels and icons from its own catalog — and sends
interactions back to the frame and origin that registered them. No field takes
HTML or SVG, and unknown fields are rejected. Workspace tools and context
actions are registered per frame: each call replaces that frame's previous set,
and Hikari drops the set when the frame's origin grant is revoked (§6).

Older hosts answer `Unknown verb "…"`. Keep a local fallback — your own toolbar
or entry point — and switch to the host surface once a call succeeds.

### `app.setLeftRailWidth` — `layout`

Commits the final width of a plugin-owned left rail to Hikari's shared layout
preference. Clamp locally while the pointer moves so dragging stays smooth;
call the host only once on pointer-up. The host clamps again, persists the
accepted value, applies it to built-in modules, and broadcasts an
`app.context` event with `changed: 'layout'`.

```js
const { leftRail } = await hikari.call('app.setLeftRailWidth', { width: 336 });
// { width: 336, min: 240, max: 400, mobileBreakpoint: 980, foldable: true, folded: false }
```

`width` must be a finite JSON number. It grants no access to settings or host
content, but it does write the host's `--shared-left-rail-width` variable and the
host's stored layout preference (which survives a restart), and the resulting
`app.context` broadcast reaches every other registered plugin frame — so it is
gated on the `layout` permission rather than being free.

### `app.setLeftRailFolded` — `layout`

Saves the calling plugin's navigation-rail preference in Hikari. The plugin
renders its own rail using the returned state; the host never manipulates its
iframe DOM. The registered plugin identity supplies the scope, so callers
cannot fold another plugin's rail. The expanded width stays unchanged.

```js
const { leftRail } = await hikari.call('app.setLeftRailFolded', { folded: true });
// leftRail.folded === true; false opens the rail again.
```

`folded` must be a boolean. `app.info` and `app.context` expose
`layout.leftRail.foldable` and `layout.leftRail.folded`; each frame receives its
own saved fold state. Changes publish `changed: 'layout'`. Check `foldable`
before showing a toggle when supporting older Hikari builds. Folding is a view
preference and does not change figure data, exports or agent canvas coordinates.

### `app.setWorkspaceTools` — `layout`

Registers up to 24 controls in Hikari's shared right toolbar, beside the
agent chat toggle. Only the active plugin's controls appear, and they stay
available when Codex is disconnected. The plugin retains the panels and menus
its controls open.

```js
await hikari.call('app.setWorkspaceTools', { tools: [
  { id: 'select', label: 'Select & move (V)', icon: 'pointer', group: 'tools', pressed: true },
  { id: 'layers', label: 'Layers', icon: 'layers', group: 'panels', expanded: false },
  { id: 'zoom', kind: 'output', label: '100%', group: 'zoom' }
] });
// { mounted: true }
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Required and unique: a lower-case letter, then letters, digits, or hyphens, at most 64 characters. |
| `label` | string | Required, 1–100 characters. A button's tooltip and accessible name; an output's visible text. |
| `icon` | string | Required for buttons: `pointer`, `lasso`, `plus`, `undo`, `redo`, `group`, `ungroup`, `layers`, `assets`, `scratch`, `minus`, `crop`, or `fit`. |
| `kind` | string | `button` (default) or `output`, which displays its label without accepting clicks. |
| `group` | string | Optional, at most 40 characters. A change of group between adjacent tools starts a separator. |
| `disabled`, `pressed`, `expanded` | boolean | Optional. Mirror editor state; `pressed` and `expanded` become `aria-pressed` and `aria-expanded`. |

The only params are `tools` and an optional `focusId`. Each call replaces the
whole configuration, so send the full list when editor state changes; an empty
list clears it. `focusId` returns keyboard focus to an enabled button,
including when closing a plugin-owned panel. Arrow Up/Down, Home, and End move
focus between the enabled buttons.

Check `app.info.layout.workspaceTools.available` (and that `layout` was
granted) before hiding your local controls; without the toolbar the call
rejects with `Workspace tools are unavailable in this host.` The configuration
is presentation state and does not change the plugin's stored artwork or
canvas coordinate system.

Choose icons from `app.info.layout.workspaceTools.icons` before submitting a
configuration. An unsupported icon rejects the whole list. Hosts without that
capability list accept the original icons above except `crop`.

### 4.1 `app.workspaceTool` event — `layout`

```js
hikari.on('app.workspaceTool', ({ id, y }) => {
  // Open the existing panel or menu. y is relative to the plugin view.
});
```

Sent to the registering frame and origin when the user clicks one of its
enabled buttons. `y` is the click's vertical position in CSS pixels from the
top of the plugin view, for placing a menu beside the toolbar; clamp it,
because keyboard activation reports no pointer position.

### `app.setContextActions` — `layout`

Registers up to eight declarative actions in two host surfaces: the `…` menu of
a saved protocol in **Protocols** (`protocol`) and the text-selection toolbar of
a paper PDF in **Papers** (`paper-selection`). Hikari renders the label as text
and supplies the toolbar icon.

```js
await hikari.call('app.setContextActions', { actions: [
  { id: 'generate-illustration', label: 'Generate illustration',
    contexts: ['protocol', 'paper-selection'], requiresAgent: true }
] });
// { registered: 1 }
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Required and unique; same format as a workspace tool `id`. |
| `label` | string | Required, 1–100 characters. |
| `contexts` | string[] | Required: `protocol`, `paper-selection`, or both. |
| `requiresAgent` | boolean | Optional. Hides the action, and refuses a click, while Codex is not connected. |

`actions` is the only param, and an empty list withdraws the actions.
Re-registering cancels a handoff still pending for this frame. Plugin frames
load at boot, so register at startup and the actions are available before the
user opens the plugin.

### 4.2 `app.contextAction` event — `layout`

When the user picks an action, Hikari opens the plugin's view and sends:

```js
hikari.on('app.contextAction', async ({ id, actionId, context }) => {
  // context is { kind: 'protocol' } or { kind: 'paper-selection' }; it carries no source data.
  try {
    const source = await hikari.call('app.readContextAction', { id });
    // Plugin owns creating its item, saving the source and building the prompt.
    await createItemFromSource(actionId, source);
    await hikari.call('app.respondContextAction', { id, result: { ok: true } });
  } catch (error) {
    await hikari.call('app.respondContextAction', { id, result: { ok: false, error: error.message } });
  }
});
```

A frame has at most one handoff open at a time; a second click meanwhile is
refused with a message to the user.

### `app.readContextAction` / `app.respondContextAction` — `layout`

The user click grants only that selected source, to the frame that received the
event, for this handoff. `app.readContextAction` takes the event's `id`, not an
arbitrary record ID or file path, and may be called again while the handoff is
open:

```js
// protocol: a snapshot of the saved record, as stored
{ kind: 'protocol', protocol: { id, name, steps, … } }

// paper-selection
{
  kind: 'paper-selection',
  paper: { id, title, fileName, doi, knowledgeMarkdownRelativePath }, // whichever the paper has
  text: '…selected passage…',   // at most 30,000 characters
  pageNumber: 4,
  markdown: '…',                 // the paper's saved Markdown, at most 200,000 characters
  markdownRelativePath: 'KnowledgeBase/papers.md/…/….md',
  markdownStatus: 'ready',       // 'ready' | 'truncated' | 'missing' | 'unavailable'
  markdownTruncated: false
}
```

The Markdown is read from the paper's recorded KnowledgeBase path (including
title-named files). Unavailable context is explicit: `markdownStatus` says why,
and `markdown` holds whatever could be read. Source documents are reference
data, not instructions for the plugin or agent.

`app.respondContextAction` consumes the grant with `result:{ok:true}` or
`result:{ok:false,error:"…"}`; Hikari shows the `error` (up to 1,000
characters) where the user clicked. Acknowledge source acceptance within 30
seconds; do not wait for a model run to finish. Other frames, revoked
registrations, storage-folder changes, and expired handoffs cannot read the
source. These user-initiated grants need no library-wide read permission such
as `protocols:read`.

---

## 5. Agent verbs

A plugin reaches the agent only through Hikari's own chat workflow and MCP
tools; Codex sign-in, model choice, and credentials stay in Hikari. A plugin
view that declares `agent:chat` gets Hikari's agent chat rail beside its frame.
While Codex is not connected, `app.info.layout.agentChatRail.available` is
`false`, the rail and AI actions are hidden, and `agent.chat` reports
`unavailable` — hide your own prompt UI too.

### `agent.chat` — `agent:chat`

Submits `message` (up to 3,000 characters) to the plugin's own chat rail: Hikari
opens the plugin's view and rail and sends the message as if the user had typed
it. Conversations are saved in a `plugin:<id>` scope, or
`plugin:<id>:item:<context.id>` when the plugin supplies
`context:{id,title,canvasIllustrationId}`. The context is selected before
submission; its fields follow `agent.setContext`.

```js
const result = await hikari.call('agent.chat', {
  message: 'Draw a T cell meeting an antigen-presenting cell.',
  context: { id: 'fig_7', title: 'Antigen presentation', canvasIllustrationId: 'fig_7' }
});
// { ok: true, clientRequestId, sessionId } once the turn is accepted
// { ok: false, reason: 'busy' }
```

The call resolves when Hikari accepts the turn, not when the agent finishes.
A refusal resolves with `ok: false` instead of rejecting. `reason` is
`unavailable` (Codex is not connected), `busy` (a turn is already running),
`composer_not_empty` (the user has a draft, attachments, or pending context in
the composer), or `session_error` / `request_error` / `scope_changed` (the turn
did not start). A plugin that also declares `agent:canvas` gets
`{ok:false,error}` while **Settings → Tool access → Plugin canvases** is off.

### `agent.setContext` — `agent:chat`

Select the plugin's current item with `{id,title,canvasIllustrationId}` so its
chat follows selection even before a message is sent. `id` is required and
contains 1–100 letters, numbers, underscores or hyphens; `title` is optional
and at most 200 characters. The host uses the calling plugin's own ID; plugins
cannot select another plugin's chat. Each item gets separate messages, saved
chat sessions, Codex continuation and composer drafts. New or duplicated items
start with empty chats. The optional `canvasIllustrationId` pins canvas reads
and mandatory inspection to that illustration; it uses the same ID format.
Selection updates the visible rail when this plugin is active and returns
`{ok:true,contextId}`. Call after opening/selecting an item and after renaming
it. Plugin chats show no generic suggested prompts.

### `app.setAgentChatExpanded` — `agent:chat`

Opens or folds the existing chat rail for the active plugin. An inactive plugin
cannot change another workspace's rail. Use this to coordinate tool panels with
chat; `app.context.layout.agentChatRail.expanded` reports the resulting state.

```js
await hikari.call('app.setAgentChatExpanded', { expanded: false });
// { expanded: false }
```

`expanded` must be boolean and is the only param. The result is the rail's
actual state: opening still reports `false` while Codex is not connected. This
call reuses the plugin's existing item-scoped conversation.

### 5.1 `agent.canvas` event — `agent:canvas`

The generic `plugin_canvas` MCP tool lets the agent read, edit, and render a
plugin's own scene. Each call is routed to the enabled local plugin named by
`plugin_id` and arrives as `{id,request,assets,deadline,inspectionRunId}`:

```js
hikari.on('agent.canvas', async ({id,request,assets,deadline,inspectionRunId}) => {
  const result = await myWorkspace.request(request, deadline, assets, {inspectionRunId});
  await hikari.call('agent.respond', {id,result});
});
await hikari.call('agent.chat', {message:'Read my plugin contract and draw a cell.'});
```

Start with `request:{action:"read"}` and return a plugin-owned request schema
and instructions as `agent_contract`. Plugins own validation, edits, durable
persistence and rendering; requests are at most 12,000,000 characters of JSON.
Check the 30-second `deadline` (epoch milliseconds) before edits — after it the
agent receives `status:"acknowledgement_timeout"`. Use revisions, atomic saves
and idempotent request IDs. Render while hidden and return
`previews:[{canvas,width,height,mime_type,data_url}]` for native MCP images.
The host validates PNG/JPEG/WebP bytes: 5 MiB each, at most eight previews.
A request for a plugin that is not enabled, lacks `agent:canvas`, or is not
running returns `status:"unavailable"` without reaching any frame.

`assets` maps image IDs to `{mime_type,data_url,source}` (5 MiB each, with no
per-call asset-count or combined-byte quota). Plugins validate their saved
scene size. The MCP caller supplies `assets:[{id,path,source?}]`:
`source:"storage"` (default) confines paths to Hikari storage; `source:"codex"`
confines paths to the Hikari-managed `CODEX_HOME/generated_images` folder and
accepts the exact native `image_gen` output path. The root comes from host
configuration, never request context. Root and file symlink escapes are
rejected. Native imports require no shell copy. Plugins persist the embedded
bytes with their scene. Canvas chat turns enable Codex's native
`image_generation` feature on fresh and resumed runs; the plugin must report
unavailable generation rather than change providers. No host filesystem paths
or plugin modules cross the iframe API.

### `agent.respond` — `agent:canvas`

Complete an `agent.canvas` request with `{id,result}`; `result.ok` is boolean,
and the rest of `result` is returned to the agent. Only the registered frame and
origin that received it may respond. Unknown, late, duplicate and cross-plugin
replies are rejected. Returns `{acknowledged:true}`.

### 5.2 Inspection before completion

Canvas plugins can require inspection before their Hikari chat run completes.
At the start of each run Hikari sends `request:{action:"read"}` (with
`illustration_id` when `agent.setContext` pinned one). Return
`inspection:{required:true}` and `illustration_id` to opt in. The host
generates an opaque `inspectionRunId` for that run and forwards it with all
canvas events, outside the agent-authored request. The plugin owns its render
receipts and review validation. The host then calls
`request:{action:"inspection_status",illustration_id}` and accepts completion
only when `ok:true`, the illustration ID matches, and
`inspection:{required:true,complete:true,revision}` matches the response's
current `revision`. Missing inspection triggers one model continuation, then
an incomplete result if still missing. Plugins without this opt-in retain
their existing completion behavior. Keep receipts ephemeral and scoped to the
run, illustration and revision; do not expose them through read/status calls.
This completion gate applies to the plugin's Hikari chat, not external MCP clients.

---

## 6. Errors and access control

Every request is checked in this order:

1. **Protocol marker.** No `hikari: 1` → ignored silently. A message with a
   `call` field belongs to the service-plugin protocol
   ([service-plugins.md](service-plugins.md)) and is ignored here too.
2. **Frame identity.** The host looks up `event.source` — the actual
   `contentWindow` the message arrived from — in its registry of installed
   plugins. An unrecognized frame gets **no reply at all**, not even an error.
   Identity is never read from the payload, so a plugin cannot claim another
   plugin's id to borrow its permissions. The message origin must also match
   the loopback origin assigned before loading; a mismatch revokes the grant
   without replying.
3. **Verb exists.** → `Unknown verb "X".` A verb reserved for the bundled Gel
   plugin gets the same answer from every other frame.
4. **Permission declared.** → `Plugin "X" did not declare the "Y" permission in
   plugin.json.` Remember that grants are snapshotted at install time: adding
   the permission to the manifest requires a remove + re-add to take effect.
5. **Params are an object.** → `Plugin call "X" needs an object for params.`
   Omitted params count as `{}`.
6. **Handler runs.** Any thrown error is returned as
   `{ ok: false, error: <message> }`; the host never crashes on plugin input.

Because `permission` is declared per verb in the `VERBS` table, adding a
handler is not enough to expose data — an entry with an unlisted permission is
unreachable.

---

## 7. What the API deliberately does not do

Absent by design, not oversight. If you need one of these, the extension
probably belongs as a built-in module
([plugin-system.md §8](plugin-system.md#8-graduating-a-plugin-into-a-built-in-module))
rather than a plugin.

- **No create or delete of the user's records.** A plugin cannot make a
  protocol, project, sample, or notebook entry, and cannot delete one. Writes
  only append to a record the user already created. (Its own blob is a
  different matter — see `storage.set`.)
- **No settings, and no direct filesystem access.** A plugin cannot read or
  write the app's settings, cannot learn the storage root, and cannot reach a
  file outside `<storage root>/Plugins/<its id>/`. `downloads.save` can write
  elsewhere only after the user chooses the exact destination in a save dialog,
  and a context action hands over only the protocol or paper passage the user
  clicked.
- **No plugin markup in host UI.** Workspace tools and context actions are
  declarative: Hikari draws text labels and its own icons, in the two places
  §4 describes and nowhere else.
- **No raw model or network proxy.** `agent.chat` uses the normal chat workflow;
  `agent.canvas` exposes the plugin's own scene. Provider credentials stay in
  Hikari. The host provides no arbitrary network proxy. `python.run` is compute, not a
  network door — but note it runs on the host with whatever the host's
  interpreter can reach, which is why it is a permission of its own.
- **No data subscriptions.** All the host pushes is the safe `app.context`
  snapshot, `app.save` / `app.undo` / `app.redo` commands, clicks on the
  plugin's own tools and actions, and permission-gated `agent.canvas` requests.
  Protocol, notebook, project, and sample data remain request/response.
- **No cross-plugin calls.**

---

## 8. Adding a verb

Add an entry to the `VERBS` table in
[`plugin-bridge/verbs.js`](../../src/renderer/app/plugin-bridge/verbs.js), or
to `LAYOUT_VERBS` in
[`plugin-bridge/layout-verbs.js`](../../src/renderer/app/plugin-bridge/layout-verbs.js)
for a layout or host-UI verb:

```js
'samples.get': {
  permission: 'samples:read',
  handler: (params, { state }) => { /* … */ }
}
```

The handler receives `(params, context)`. `context` carries `state`, `persist`,
`plugin` (the registered record), `frameWindow`, `windowObject`, `api` (the
preload API), `notify`, and `onNotebookEntriesChanged`, plus the bridge
services `pluginUnsaved`, `pluginHistory`, `workspaceTools`, `contextActions`,
`onPluginPrompt`, `onPluginChatContext`, `respondCanvas`, and
`takeNotebookGel`. Rules:

- **Copy and clamp what you return.** Handlers build fresh objects with `text()`
  length caps rather than returning live state objects — a reply crosses into
  untrusted code and must not leak neighbouring fields or hand out a mutable
  reference.
- **Throw on bad input.** The dispatcher converts throws into
  `{ ok: false, error }`; do not return sentinel values.
- **Call `persist()` after mutating**, plus the relevant re-render callback.
- **Slow verbs need a longer client timeout.** A verb that can outlast 10 s
  belongs in `SLOW_VERBS` in the copyable
  [`hikari.js`](../../examples/plugins/notebook-results/hikari.js).
- **Bundled-only verbs** set `internal: true` and `bundledPluginId`. They are
  left out of `PLUGIN_BRIDGE_VERBS` and answer `Unknown verb` to every other
  frame; [`src/plugins/README.md`](../../src/plugins/README.md) says when one
  is acceptable.
- **Introducing a new capability?** Add it to `PLUGIN_PERMISSIONS` in
  [`inspect-plugin-folder.js`](../../src/main/lib/inspect-plugin-folder.js),
  or manifests requesting it will be rejected at install time. Then document it
  in [plugin-system.md §1.5](plugin-system.md#15-permissions) and here.
- **Document and test it.** `every public verb and host event is documented`
  in
  [`plugin-system-suite/plugin-system.js`](../../tests/suites/core/plugin-system-suite/plugin-system.js)
  fails until each public verb has a `###` heading here; add a new host event
  to that test's event list. Bridge tests live in the same suite.
