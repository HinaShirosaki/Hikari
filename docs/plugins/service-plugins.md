# Service plugins

A **service** plugin has no view. It installs and is managed in Settings
exactly like any other plugin — same row, same toggle, same Remove — but at
runtime it opens no workspace. Instead it runs hidden and registers a
capability that a built-in feature calls into.

Today the one capability is **file conversion**: a service declares that it can
turn one file extension into another, and a feature that opens files gains the
ability to open the source format. The reference example,
[`snapgene-dna`](../../examples/plugins/snapgene-dna/), lets the Sequence
Viewer open SnapGene `.dna` files by converting them to GenBank.

Prerequisite: [plugin-system.md](plugin-system.md) for the folder contract.

---

## 1. The manifest

```json
{
  "id": "snapgene-dna",
  "name": "SnapGene .dna importer",
  "version": "1.0.0",
  "service": {
    "fileConversions": [
      { "from": "dna", "to": "gbk" }
    ]
  }
}
```

`service.fileConversions` is what makes a plugin a service. Each pair is a bare,
lower-case extension (no dot). `from` is the format the plugin reads; `to` is
what it produces. A manifest with `service` may not also set `embed` or `serve`
(§4). Everything else is a normal local plugin.

## 2. How it runs — and why it has no UI

A service is local plugin code delivered through Hikari's private per-plugin
loopback server (§1.0 in [plugin-system.md](plugin-system.md)). This is automatic;
the manifest remains a `service` and must not set `serve: true`. At boot,
[`plugin-loader.js`](../../src/renderer/app/plugin-loader.js) mounts its
`index.html` in a **hidden** iframe — no view section, no navigation entry, no
rail — and registers its declared conversions with the service registry
([`plugin-services.js`](../../src/renderer/app/plugin-services.js)).

**A service is headless and must stay that way.** Its `index.html` is not a
page — it is only the script host the sandbox requires, and it should contain
nothing but `<script>` tags. The service's own code must not touch the DOM; if
it needs to show something, it is a view plugin, not a service. This is not
just convention: the frame is mounted `hidden` and pinned to `display: none` by
`.plugin-service-frame`, so a service cannot render even if its document
contains markup. See
[plugin-system.md §1.6](plugin-system.md#16-a-service-has-no-ui).

The one thing a service must ship that looks UI-shaped is that single
`index.html`. It exists because a sandboxed frame needs a document to execute a
script in; it draws nothing.

A service may separately declare the `notifications` permission and call
[`notifications.show`](plugin-api.md#notificationsshow--notifications). The
toast is host-owned and attributed to the plugin; it does not unhide the frame
or create a plugin view. Reserve it for a completion or recoverable error, not
for per-file progress. The reference `snapgene-dna` service requests only
`python` and does not show notifications.

The loopback origin lets packaged Electron load the script host and its sibling
files; an external `file:` frame is blocked from doing so. Classic and module
scripts both work. The example keeps three small classic scripts so their load
order is explicit.

## 3. The conversion protocol

The host calls the service — the reverse of the
[host API](plugin-api.md), where the plugin calls the host. Over
`postMessage`:

```js
// host  -> service
{ hikari: 1, call: 'convert', id, from: 'dna', to: 'gbk', filename, bytes }
// service -> host
{ hikari: 1, call: 'convert:result', id, ok: true,  text: '<GenBank>' }
{ hikari: 1, call: 'convert:result', id, ok: false, error: '<message>' }
// service -> host, once at startup after the listener is installed
{ hikari: 1, call: 'service:ready' }
```

`bytes` is a `Uint8Array` of the raw file, cloned across the boundary. The
`call` discriminator keeps this off the host-API channel (which carries a
`verb`), so a page can do both without crosstalk. A service frame is also
registered with the permission-gated host-API bridge. This lets a converter
use a narrowly declared capability such as `python.run` without gaining any
undeclared Hikari access.

The registry accepts a conversion declaration at boot so the file picker can
offer `.dna` immediately, but it does not post bytes until `service:ready`
arrives. A startup failure is therefore reported as a service-start error,
instead of waiting for a misleading per-file conversion timeout.

A service worker is a few lines — listen, convert, reply:

```js
window.addEventListener('message', async (event) => {
  const req = event.data;
  if (!req || req.hikari !== 1 || req.call !== 'convert') return;
  try {
    const text = await window.SnapGeneBiopython.convertWithPython(
      window.HikariPlugin.hikari,
      req.bytes,
      { filename: req.filename }
    );
    window.parent.postMessage({ hikari: 1, call: 'convert:result', id: req.id, ok: true, text }, '*');
  } catch (error) {
    window.parent.postMessage({ hikari: 1, call: 'convert:result', id: req.id, ok: false, error: String(error.message) }, '*');
  }
});
window.parent.postMessage({ hikari: 1, call: 'service:ready' }, '*');
```

## 4. What consumes it

The Sequence Viewer's file-open path
([`home-controller.js`](../../src/renderer/modules/sequence-viewer/home-controller.js))
asks the registry whether any installed service converts the file's extension.
If one does, it reads the file as bytes, sends them to that service, and parses
the returned text; otherwise it reads the file as text as before. The file
picker's `accept` list is widened with the registered extensions, so a `.dna`
file is selectable (and droppable) once the service is installed.

The registry reaches the Sequence Viewer through the module runtime
(`manifestContext.pluginServices` →
[`sequence-viewer` manifest](../../src/renderer/module-manifests/sequence-viewer.js)
`createOptions`), so no other module is coupled to plugins.

Wiring a different feature to services is the same three steps: take
`pluginServices` from the manifest context, call `getConverter(ext)` on the
file's extension, and `convert({ extension, filename, bytes })` when one exists.

## 5. Security

A service is untrusted local code you installed, sandboxed like any local
plugin. Two things specific to services:

- **It receives file bytes, nothing else from the service registry.** Like any
  local plugin, it may call only the host capabilities listed in its manifest.
  The example declares `python`, which grants sandboxed computation but no
  Hikari records or filesystem paths.
- **It can still reach the network.** Like any plugin page it may `fetch()`, so
  a malicious converter could exfiltrate the file it was handed. Only install
  service folders you trust — the same rule as every plugin.

First registration wins per extension, so an installed service cannot hijack a
format another service already claimed.

## 6. Limits

- **File conversion is the only host-to-service capability.** There is no
  general background-task protocol; a service answers convert requests and
  may use only its separately declared host API permissions.
- **One hop, one file.** No chaining (`.dna → .gbk → …`), no multi-file
  bundles, no streaming — bytes in, text out, 15-second timeout.
- **Hidden but loopback-served.** The service gets its own origin so installed
  script files load in packaged Electron, while the host remains cross-origin.

## 7. Testing

`npm test` covers the shape and the example end to end:

- `service plugins declare file conversions and stay local` — manifest
  validation, including the `embed`/`serve` exclusions.
- `plugin service registry routes a conversion to the owning frame` — the
  registry posts to the right frame and resolves/rejects on its reply.
- `a service plugin mounts a hidden frame and no view` — `installPlugins`
  creates a hidden loopback-served frame and no navigation entry.
- `.dna converts to GenBank the sequence viewer can parse` — a fixture `.dna`
  goes through the real converter and the viewer's own GenBank parser reads the
  sequence and topology back.

The focused plugin test runs the real Biopython program through Hikari's Python
sandbox and parses its returned GenBank with the Sequence Viewer parser.
