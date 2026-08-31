# Hikari Plugin Host API

The host API is how a sandboxed plugin reads and writes Hikari data. It uses a
`postMessage` request/response protocol plus a small host-event channel between
the plugin's iframe and the host page, implemented in
[`src/renderer/app/plugin-bridge.js`](../../src/renderer/app/plugin-bridge.js).

Start with [quickstart.md](quickstart.md) for a copyable plugin. Use
[plugin-system.md](plugin-system.md) for the complete folder contract and how
`permissions` are declared and frozen.

**Local and served plugins only.** A remote plugin (one with `embed` in its
manifest) cannot hold permissions and its frame is never registered with the
bridge, so none of this applies to it — the API is absent there, not merely
denied. See [plugin-system.md §1.0](plugin-system.md#10-four-kinds-of-plugin).

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

The client is intentionally a classic script, so the same copy works in both
opaque-origin local plugins and loopback-served plugins. Local plugins cannot
load relative ES modules; see
[plugin-system.md §5.4](plugin-system.md#54-opaque-origins-cannot-load-es-modules).

`hikari.call(verb, params)` resolves with the verb's result or rejects with an
`Error` carrying the host's message. Calls time out after 10 s — the host
stays silent for unregistered frames (§4), so without a timeout a call from a
disabled plugin, or from the page opened directly in a browser, would hang
forever. The client rejects immediately for an empty verb, non-object params,
an unavailable parent frame, or a value that `postMessage` cannot clone.

The 10 s budget is for "nobody is listening", which is answered in
milliseconds or never. Verbs that wait on a person, on megabytes of disk I/O,
or on a subprocess get 10 minutes instead — `downloads.save`, `files.write`,
`files.read`, and `python.run`. There is no cancel message, so a client that
gave up early would report failure for work the host goes on to finish.

`hikari.on(event, listener)` subscribes to the host's events: the context
snapshot in §2.1, and the `app.save` / `app.undo` / `app.redo` commands in §3.1
and §3.2. It returns an unsubscribe function.

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

Replies are posted with `targetOrigin: '*'` because a local plugin's opaque
origin serializes to `"null"` and cannot be targeted. The host therefore never
puts anything in a reply that the plugin did not ask for and hold permission to
read. Access control rests on frame identity (§4), not on the origin string.

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
//     leftRail: { width: 280, min: 240, max: 400, mobileBreakpoint: 980 }
//   }
// }
```

The storage value is deliberately a boolean. It lets a plugin disable file
actions without revealing the user's storage path.

`layout.leftRail` is safe presentation context for plugins that draw their own
two-pane workspace. It reports the host's current persisted rail width and
clamping limits; it does not expose host DOM or settings.

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

### `app.setLeftRailWidth` — `layout`

Commits the final width of a plugin-owned left rail to Hikari's shared layout
preference. Clamp locally while the pointer moves so dragging stays smooth;
call the host only once on pointer-up. The host clamps again, persists the
accepted value, applies it to built-in modules, and broadcasts an
`app.context` event with `changed: 'layout'`.

```js
const { leftRail } = await hikari.call('app.setLeftRailWidth', { width: 336 });
// { width: 336, min: 240, max: 400, mobileBreakpoint: 980 }
```

`width` must be a finite JSON number. It grants no access to settings or host
content, but it does write the host's `--shared-left-rail-width` variable and the
host's stored layout preference (which survives a restart), and the resulting
`app.context` broadcast reaches every other registered plugin frame — so it is
gated on the `layout` permission rather than being free.

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
unsaved-changes dialog at quit time and offers to save it.

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
does not light them up.

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
  rejected outright — the validation is in the bridge, because the underlying
  host calls would happily read any absolute path they were handed.
- **`files.write` returns the path that was actually written**, which may
  differ from the one you asked for if a file of that name already existed.
  Store what comes back and read with that.
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
| `text` | string | Optional. Appended to `resultText` after a blank line, preserving what was there. |
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

## 4. Errors and access control

Every request is checked in this order:

1. **Protocol marker.** No `hikari: 1` → ignored silently.
2. **Frame identity.** The host looks up `event.source` — the actual
   `contentWindow` the message arrived from — in its registry of installed
   plugins. An unrecognized frame gets **no reply at all**, not even an error.
   Identity is never read from the payload, so a plugin cannot claim another
   plugin's id to borrow its permissions.
3. **Verb exists.** → `Unknown verb "X".`
4. **Permission declared.** → `Plugin "X" did not declare the "Y" permission in
   plugin.json.` Remember that grants are snapshotted at install time: adding
   the permission to the manifest requires a remove + re-add to take effect.
5. **Handler runs.** Any thrown error is returned as
   `{ ok: false, error: <message> }`; the host never crashes on plugin input.

Because `permission` is declared per verb in the `VERBS` table, adding a
handler is not enough to expose data — an entry with an unlisted permission is
unreachable.

---

## 5. What the API deliberately does not do

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
  elsewhere only after the user chooses the exact destination in a save dialog.
- **No agent, LLM, or network verbs.** A plugin can `fetch()` on its own like
  any webpage; the host will not proxy it. `python.run` is compute, not a
  network door — but note it runs on the host with whatever the host's
  interpreter can reach, which is why it is a permission of its own.
- **No data subscriptions.** All the host pushes is the safe `app.context`
  snapshot and the parameterless `app.save` / `app.undo` / `app.redo` commands.
  Protocol, notebook, project, and sample data remain request/response.
- **No cross-plugin calls.**

---

## 6. Adding a verb

In [`plugin-bridge.js`](../../src/renderer/app/plugin-bridge.js), add to the
`VERBS` table:

```js
'samples.get': {
  permission: 'samples:read',
  handler: (params, { state }) => { /* … */ }
}
```

The handler receives `(params, { state, persist, plugin, onNotebookEntriesChanged })`.
Rules:

- **Copy and clamp what you return.** Handlers build fresh objects with `text()`
  length caps rather than returning live state objects — a reply crosses into
  untrusted code and must not leak neighbouring fields or hand out a mutable
  reference.
- **Throw on bad input.** The dispatcher converts throws into
  `{ ok: false, error }`; do not return sentinel values.
- **Call `persist()` after mutating**, plus the relevant re-render callback.
- **Introducing a new capability?** Add it to `PLUGIN_PERMISSIONS` in
  [`inspect-plugin-folder.js`](../../src/main/lib/inspect-plugin-folder.js),
  or manifests requesting it will be rejected at install time. Then document it
  in [plugin-system.md §1.5](plugin-system.md#15-permissions) and here, and
  extend the bridge test in [`test.js`](../../test.js).
