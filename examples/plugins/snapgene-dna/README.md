# SnapGene .dna importer — example service plugin

A **service plugin**: it has no view and never appears in navigation. It runs
hidden and registers a capability — converting SnapGene `.dna` files to GenBank
— so the **Sequence Viewer can open `.dna` files** it cannot parse natively.

```json
{
  "id": "snapgene-dna",
  "name": "SnapGene .dna importer",
  "version": "1.0.0",
  "service": {
    "fileConversions": [{ "from": "dna", "to": "gbk" }]
  }
}
```

The `service.fileConversions` block is what makes this a service. Everything
else is a normal local plugin: opaque-origin sandbox, no host permissions.

## Install

**Settings → Plugins → Add Plugin Folder**, select this folder, **Reload App**.

In Settings it looks like any other plugin — same row, same toggle, same
Remove. The difference is entirely at runtime: no workspace opens for it.

## Use it

1. Open the **Sequence Viewer**.
2. **Open** a file — `.dna` is now an accepted type (you can also drag one in).
3. The viewer hands the bytes to this service, gets GenBank back, and displays
   the sequence with its features and topology.

## How it works

| File | Role |
| --- | --- |
| `plugin.json` | Declares `service.fileConversions: dna → gbk`. |
| `index.html` | Script host, **not a page** — nothing but `<script>` tags, renders nothing. |
| `main.js` | Listens for the host's convert request and replies with GenBank. Touches no DOM. |
| `dna-to-genbank.js` | The pure converter. Run `node dna-to-genbank.js` for its self-check. |

There is no HTML, CSS, or DOM code here beyond the script host: a service is
headless, and the host mounts its frame hidden and pinned to `display: none`.

The host calls the service over `postMessage` (host → service, the reverse of
the [host API](../../../docs/plugins/plugin-api.md)); the service gets the raw
bytes, never any Hikari data. See
[docs/plugins/service-plugins.md](../../../docs/plugins/service-plugins.md).

## Scope

The converter reads the sequence and topology (always) and single-range
features (best effort). It does not handle every SnapGene feature shape or
primers/notes — enough to open the file and see its map, not a full SnapGene
re-implementation.
