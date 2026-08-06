# Walkthrough: running ImageJ locally

ImageJ is the reference example for **served plugins** — the kind Hikari
delivers over `http://127.0.0.1:<port>` instead of `file://`, so the plugin
gets a real origin with working storage.

The manifest is four lines:

```json
{
  "id": "imagej",
  "name": "ImageJ",
  "version": "1.0.0",
  "serve": true
}
```

Source: [`examples/plugins/imagej/`](../../examples/plugins/imagej/). Run
`./fetch-imagej.sh` once to download the compiled ImageJ, install the folder,
reload, and **More → ImageJ** is real ImageJ 1.53m — File, Edit, Image,
Process, Analyze, Plugins, Window, Help — with your images staying on your
machine. ImageJ fills the whole pane — the host draws no chrome around a plugin
frame ([plugin-system.md §4.1](plugin-system.md#41-boot-sequence)), so what you
see is ImageJ's own window and nothing else.

The interesting part is why `"serve": true` is load-bearing, because the same
reasoning applies to anything with a real runtime behind it.

---

## 1. Why a local plugin cannot run it

ImageJ is Java. In a browser that means
[ImageJ.JS](https://github.com/imjoy-team/imagej.js) — ImageJ compiled to
WebAssembly by [CheerpJ](https://cheerpj.com/) — and CheerpJ keeps its virtual
filesystem in **IndexedDB**.

A local plugin is an opaque origin, and an opaque origin has no storage.
Probing Hikari's local sandbox string gives:

```
origin:              "null"
localStorage:        BLOCKED: SecurityError
indexedDB:           BLOCKED: SecurityError
SharedArrayBuffer:   absent
crossOriginIsolated: false
WebAssembly:         present
```

WebAssembly is available; the storage CheerpJ needs is not. And it does not
degrade gracefully — loading ImageJ.JS in that sandbox reaches `loader present`
and then stops. `cheerpjInit` never resolves, and CheerpJ never even logs that
it started initializing. Nothing times out; the plugin just sits there.

## 2. What `serve: true` changes

Serving the folder over loopback gives the frame a real origin. The same page,
same sandbox flags plus `allow-same-origin`, on `http://127.0.0.1:<port>`:

```
origin:            http://127.0.0.1:59543
indexedDB:         OK
loader present | cheerpjInit resolved | display created | runMain called
```

ImageJ boots. The `allow-same-origin` flag is safe here because the frame's
origin is the loopback port, not Hikari's `file://` — verified from the host
side, which sees `contentDocument: null` and `localStorage: SecurityError` on
the frame. Each served plugin gets its own port, so they are isolated from each
other too, not just from the host. Details in
[plugin-system.md §5.1](plugin-system.md#51-why-served-and-remote-plugins-may-use-allow-same-origin).

## 3. What is local and what is not

Be precise about this, because "runs locally" is half true:

| Piece | Where it comes from |
| --- | --- |
| ImageJ jars, plugins, macros, LUTs (~59 MB) | your disk, served over loopback |
| Images you open | never leave the machine |
| The CheerpJ runtime (`loader.js` + JVM) | `cjrtnc.leaningtech.com`, on first run |

The runtime is the one piece that cannot be bundled. ImageJ.JS is MIT, but it
is a shell around CheerpJ, and [CheerpJ's
licensing](https://cheerpj.com/docs/licensing.html) makes the runtime free only
when loaded from their CDN — self-hosting it requires a commercial license. So
**fully offline ImageJ is not something this repo can ship**, and the plugin
needs internet on first run.

What you do get, compared with embedding a hosted ImageJ: your images stay
local, and the app code sits in a folder you can read.

## 4. The plugin

`index.html` loads the CheerpJ runtime from the CDN and its own `main.js`:

```html
<script src="https://cjrtnc.leaningtech.com/20201217_2/loader.js"></script>
```

`main.js` boots the JVM and hands it ImageJ's jar. `/app` maps to the plugin's
server root, so `/app/ij153/ij-1.53m.jar` is `./ij153/ij-1.53m.jar` in the
folder:

```js
await cheerpjInit({
  javaProperties: [
    'java.protocol.handler.pkgs=com.leaningtech.handlers',
    'user.dir=/files',
    'plugins.dir=/app/ij153/plugins'
  ]
});
cheerpjCreateDisplay(-1, -1, document.getElementById('imagej-container'));
cheerpjRunMain('ij.ImageJ', '/app/ij153/ij-1.53m.jar');
```

It checks `location.protocol === 'file:'` first and says so plainly, because
the failure mode otherwise is a frame that hangs with no error — exactly the
symptom from §1.

The 59 MB of jars are downloaded by `fetch-imagej.sh` rather than vendored, and
`ij153/` is gitignored.

## 5. Install and check

1. `cd examples/plugins/imagej && ./fetch-imagej.sh`
2. **Settings → Plugins → Add Plugin Folder**, select that folder.
3. **Reload App**, then **More → ImageJ**. First boot takes 20–30 seconds while
   the JVM loads.
4. **File → Open Samples → Blobs**, then **Analyze → Analyze Particles** to
   confirm it is a real, working ImageJ.

To get measurements into a notebook entry, use the
[`notebook-results`](../../examples/plugins/notebook-results/) plugin — paste
the Results table there. ImageJ itself holds no host permissions; it is a
served plugin and *could*, but this one declares none, so it has no route into
your data.

## 6. When to reach for `serve: true`

Use it when the plugin needs storage — `localStorage`, `IndexedDB`, a
WebAssembly runtime with a filesystem, a large asset tree it fetches at
runtime. The tell is a library that works in a normal browser tab and
mysteriously hangs or throws `SecurityError` as a local plugin.

Do **not** use it just because it sounds more capable. A plain local plugin has
a smaller attack surface: no server, no `allow-same-origin`, no storage to
leak. Reach for serving when the opaque origin actually blocks you, which you
will know because something breaks.
