# Notebook Results Import — example local plugin

Paste a measurement table (ImageJ Results format — CSV or tab-separated), pick
a notebook entry, and the rows are attached to it as a notebook result table.

This is the reference example for the **host API**: it uses a read verb
(`notebook.list`) and the write verb (`notebook.appendResult`), and declares
exactly those two permissions and nothing else.

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
| `main.js` | UI wiring and the host API calls. |
| `parse-results.js` | CSV/TSV parser. Run `node parse-results.js` for its self-check. |
| `hikari.js` | Host API client. Copy this verbatim into your own plugin. |
| `style.css` | All styling — plugins inherit nothing from the host. |

Walkthrough: [`docs/plugins/imagej-walkthrough.md`](../../../docs/plugins/imagej-walkthrough.md).
