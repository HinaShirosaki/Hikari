# Hikari Plugin Host API

The host API is how a sandboxed plugin reads and writes Hikari data. It is a
`postMessage` request/response protocol between the plugin's iframe and the
host page, implemented in
[`src/renderer/app/plugin-bridge.js`](../../src/renderer/app/plugin-bridge.js).

Prerequisite: [plugin-system.md](plugin-system.md) for the folder contract and
how `permissions` are declared and frozen.

**Local and served plugins only.** A remote plugin (one with `embed` in its
manifest) cannot hold permissions and its frame is never registered with the
bridge, so none of this applies to it — the API is absent there, not merely
denied. See [plugin-system.md §1.0](plugin-system.md#10-four-kinds-of-plugin).

---

## 1. The client

Copy [`examples/plugins/notebook-results/hikari.js`](../../examples/plugins/notebook-results/hikari.js)
into your plugin folder. It wraps the raw protocol in promises:

```js
import { hikari } from './hikari.js';

const entries = await hikari.call('notebook.list');
await hikari.call('notebook.appendResult', { entryId: entries[0].id, text: 'done' });
```

`hikari.call(verb, params)` resolves with the verb's result or rejects with an
`Error` carrying the host's message. Calls time out after 10 s — the host
stays silent for unregistered frames (§4), so without a timeout a call from a
disabled plugin, or from the page opened directly in a browser, would hang
forever.

### 1.1 The raw protocol

If you would rather not use the client, the wire format is:

```js
// plugin -> host  (always to window.parent, targetOrigin '*')
{ hikari: 1, id: "<your correlation id>", verb: "notebook.list", params: {} }

// host -> plugin
{ hikari: 1, id: "<same id>", ok: true,  result: <json> }
{ hikari: 1, id: "<same id>", ok: false, error: "<message>" }
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
// { host: 'hikari', pluginId: 'notebook-results', permissions: ['notebook:read', 'notebook:write'] }
```

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

---

## 3. Write verbs

### `notebook.appendResult` — `notebook:write`

Appends results to an **existing** notebook entry. This is the only write verb.

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

- **No create or delete.** A plugin cannot make a protocol, project, sample, or
  notebook entry, and cannot delete anything. Writes only append to a record
  the user already created.
- **No settings, storage paths, or filesystem access.**
- **No agent, LLM, or network verbs.** A plugin can `fetch()` on its own like
  any webpage; the host will not proxy it.
- **No subscriptions.** Request/response only — there are no host-initiated
  events, so poll if you need to observe change.
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
  in [plugin-system.md §1.2](plugin-system.md#15-permissions) and here, and
  extend the bridge test in [`test.js`](../../test.js).
