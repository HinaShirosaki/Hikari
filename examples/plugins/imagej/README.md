# ImageJ — example served plugin

Real ImageJ 1.53m, running inside Hikari as a workspace, with your images
staying on your machine.

This is the reference example for **served plugins** — the kind Hikari delivers
over `http://127.0.0.1:<port>` rather than `file://`, so the plugin gets a real
origin with working storage. That is not a nicety here: CheerpJ keeps ImageJ's
filesystem in IndexedDB, which an opaque `file://` origin denies outright.
Current Hikari versions also use loopback delivery for local plugins without
`serve: true`; the explicit flag remains compatible.

```json
{
  "id": "imagej",
  "name": "ImageJ",
  "version": "1.0.0",
  "serve": true
}
```

## Install

```sh
./fetch-imagej.sh          # downloads ~59 MB of compiled ImageJ into ./ij153
```

Then **Settings → Plugins → Add Plugin Folder**, select this folder, **Reload
App**, and open **More → ImageJ**. First boot takes 20–30 seconds while the JVM
loads.

Check it works: **File → Open Samples → Blobs**, then **Analyze → Analyze
Particles**.

## What runs locally, and what does not

| Piece | Source |
| --- | --- |
| ImageJ jars, plugins, macros, LUTs | `./ij153`, served from this folder |
| Images you open | stay on your machine |
| CheerpJ runtime (the JVM) | `cjrtnc.leaningtech.com`, needs internet on first run |

The runtime is the one piece that cannot be bundled: ImageJ.JS is MIT, but
CheerpJ's runtime is free only when loaded from their CDN, and [self-hosting
requires a commercial license](https://cheerpj.com/docs/licensing.html). So this
plugin is *local*, not *offline*.

## Files

| File | Role |
| --- | --- |
| `plugin.json` | Manifest. `serve: true` is what makes ImageJ able to start. |
| `index.html` | Entry page: loads the CheerpJ runtime and `main.js`. |
| `main.js` | Boots the JVM and runs `ij.ImageJ`. |
| `style.css` | All styling — plugins inherit nothing from the host. |
| `fetch-imagej.sh` | Downloads ImageJ into `./ij153` (gitignored, not vendored). |

## Notes

- **It holds no host permissions.** A served plugin may declare them; this one
  does not, so it has no route into your Hikari data. To get measurements into
  a notebook entry, paste the Results table into the
  [`notebook-results`](../notebook-results/) plugin.
- **Nothing outside this folder is reachable** over the plugin's server — the
  folder is the entire web root, and traversal out of it fails closed.

Walkthrough, including the measurements behind all of this:
[`docs/plugins/imagej-walkthrough.md`](../../../docs/plugins/imagej-walkthrough.md).
