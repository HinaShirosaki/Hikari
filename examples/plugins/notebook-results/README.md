# Notebook Results Import — example local plugin

Paste a measurement table (ImageJ Results format — CSV or tab-separated), pick
a notebook entry, and the rows are attached to it as a notebook result table.

This is the reference example for the **host API**: it uses a read verb
(`notebook.list`) and the write verb (`notebook.appendResult`), and declares
exactly those two permissions and nothing else.

It is also the copyable reference for a **local** plugin. Its scripts are
classic scripts loaded in dependency order. Hikari delivers the folder through
its private loopback server; ES modules are supported too. The UI keeps loading, empty, failure, retry,
and in-progress states visible instead of leaving a blank or double-submitting
an attachment.

> Looking for ImageJ itself? That is [`../imagej/`](../imagej/), a *remote*
> plugin that embeds the real application. Remote plugins cannot hold host
> permissions, which is why importing results is a separate local plugin.

## Install

1. **Settings → Plugins → Add Plugin Folder**, select this folder.
2. Confirm the row reads `Host access: notebook:read, notebook:write`.
3. **Reload App**, then open **More → Notebook Results Import**.

## Try it

Paste this, choose an entry, click **Attach**:

```
 ,Area,Mean,Min,Max
1,120.5,88.21,12,255
2,98.0,91.44,10,248
```

## Files

| File | Role |
| --- | --- |
| `plugin.json` | Manifest. `id` must match this folder's name. |
| `index.html` | Entry page — required at the folder root for a local plugin. |
| `main.js` | Classic UI script: safe DOM rendering, retry, and duplicate-submit protection. |
| `parse-results.js` | Classic CSV/TSV parser. Run `node parse-results.js` for its self-check. |
| `hikari.js` | Classic host API client. Copy this verbatim into your own local or served plugin. |
| `style.css` | All styling — plugins inherit nothing from the host. |

Start a plugin: [`docs/plugins/quickstart.md`](../../../docs/plugins/quickstart.md).
ImageJ walkthrough: [`docs/plugins/imagej-walkthrough.md`](../../../docs/plugins/imagej-walkthrough.md).
