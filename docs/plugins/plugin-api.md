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

`hikari.on(event, listener)` subscribes to the small set of host context events
in §2.1. It returns an unsubscribe function.

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
//   storage: { configured: true }
// }
```

The storage value is deliberately a boolean. It lets a plugin disable file
actions without revealing the user's storage path.

### 2.1 `app.context` event — *no permission required*

The host pushes the same safe `appearance` and `storage` context when either
changes. `changed` identifies the part that triggered the event:

```js
const unsubscribe = hikari.on('app.context', ({ appearance, storage, changed }) => {
  document.body.dataset.appearanceMode = appearance.mode;
  saveButton.disabled = !storage.configured;
});
// payload: { appearance: {...}, storage: {...}, changed: 'appearance' | 'storage' }
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
  any webpage; the host will not proxy it.
- **No data subscriptions.** The host only pushes the safe `app.context`
  snapshot. Protocol, notebook, project, and sample data remain request/response.
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
