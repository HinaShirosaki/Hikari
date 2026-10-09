# Case study: running ImageJ as a plugin

ImageJ is a useful stress test for the plugin sandbox: it is a large Java
application with a real runtime behind it. This page records what running it
as a Hikari plugin requires and what "runs locally" does and does not mean.

> The `examples/plugins/imagej/` folder this page used to link is no longer in
> the repository. It downloaded a 59 MB runtime, so it was removed along with
> its tests (`.gitignore` still lists the path for local copies). The manifest
> and code excerpts below are enough to rebuild it. For an in-repo plugin with
> a comparable amount of code, read the bundled Gel plugin in
> [`src/plugins/gel/`](../../src/plugins/gel/).

The manifest is four lines:

```json
{
  "id": "imagej",
  "name": "ImageJ",
  "version": "1.0.0",
  "serve": true
}
```

`"serve": true` is now a compatibility no-op: every folder plugin is served
over its own `http://127.0.0.1:<port>` origin ([plugin-system.md §1.0](plugin-system.md#10-four-kinds-of-plugin)).
Once installed, **More → ImageJ** is real ImageJ 1.53m — File, Edit, Image,
Process, Analyze, Plugins, Window, Help — filling the whole pane, since the host
draws no chrome around a plugin frame
([plugin-system.md §4.1](plugin-system.md#41-boot-sequence)).

---

## 1. Why it needs a real origin

ImageJ is Java. In a browser that means
[ImageJ.JS](https://github.com/imjoy-team/imagej.js) — ImageJ compiled to
WebAssembly by [CheerpJ](https://cheerpj.com/) — and CheerpJ keeps its virtual
filesystem in **IndexedDB**.

Earlier Hikari builds loaded plugins without `serve: true` from an opaque
`file:` origin, and an opaque origin has no storage:

```
origin:              "null"
localStorage:        BLOCKED: SecurityError
indexedDB:           BLOCKED: SecurityError
WebAssembly:         present
```

CheerpJ does not degrade gracefully there: loading reaches `loader present` and
stops, `cheerpjInit` never resolves, and nothing times out. That failure is why
Hikari now serves every folder plugin over loopback. On a real origin the same
page boots:

```
origin:            http://127.0.0.1:59543
indexedDB:         OK
loader present | cheerpjInit resolved | display created | runMain called
```

The frame carries `allow-same-origin`, which is safe because its origin is the
loopback port, not Hikari's `file://` — the host sees `contentDocument: null`
and `localStorage: SecurityError` on the frame. Each plugin gets its own port,
so plugins are isolated from each other as well as from the host. Details in
[plugin-system.md §5.1](plugin-system.md#51-why-plugin-frames-may-use-allow-same-origin).

## 2. What is local and what is not

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
**fully offline ImageJ is not something Hikari can ship**, and the plugin needs
internet on first run. (The host's Content-Security-Policy does not block this:
its `frame-src` only decides which origin the frame may load, and the plugin
server sends no CSP of its own.)

What you do get, compared with embedding a hosted ImageJ: your images stay
local, and the app code sits in a folder you can read.

## 3. The plugin

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

Check `location.protocol === 'file:'` first and say so plainly: if the page is
ever opened outside the plugin server, the failure mode is a frame that hangs
with no error.

Download the ImageJ jars into `ij153/` yourself rather than committing them.

## 4. Install and check

1. **Settings → Plugins → Add Plugin Folder**, select the folder.
2. **Reload App**, then **More → ImageJ**. First boot takes 20–30 seconds while
   the JVM loads.
3. **File → Open Samples → Blobs**, then **Analyze → Analyze Particles** to
   confirm it is a real, working ImageJ.

To get measurements into a notebook entry, use the
[`notebook-results`](../../examples/plugins/notebook-results/) plugin — paste
the Results table there. ImageJ itself declares no host permissions, so it has
no route into your data.

## 5. Lessons for other runtime-heavy plugins

- A library that works in a normal browser tab should now work in a plugin,
  because the frame has a real origin with `localStorage` and `IndexedDB`.
- Anything the plugin fetches from the network makes it depend on that network,
  so say so in the plugin's description.
- Declare no permissions unless the plugin needs Hikari data. A plugin with no
  permissions cannot read or write anything in Hikari, however large it is.
