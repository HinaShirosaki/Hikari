# SnapGene .dna importer — example service plugin

A **service plugin**: it has no view and never appears in navigation. It runs
hidden and registers a capability — converting SnapGene `.dna` files to GenBank
with **Biopython** — so the **Sequence Viewer can open `.dna` files** it cannot
parse natively.

```json
{
  "id": "snapgene-dna",
  "name": "SnapGene .dna importer",
  "version": "1.1.0",
  "permissions": ["python"],
  "service": {
    "fileConversions": [{ "from": "dna", "to": "gbk" }]
  }
}
```

The `service.fileConversions` block is what makes this a service. The explicit
`python` permission is the plugin's only host capability; Settings shows that
grant before the plugin is enabled.

## Prerequisite

Biopython must be installed in the Python interpreter used by Hikari:

```sh
python3 -m pip install biopython
```

The converter reports a clear error if Python or Biopython is unavailable.

## Install

**Settings → Plugins → Add Plugin Folder**, select this folder, **Reload App**.

In Settings it looks like any other plugin — same row, same toggle, same
Remove. The difference is entirely at runtime: no workspace opens for it.

## Use it

1. Open the **Sequence Viewer**.
2. **Open** a file — `.dna` is now an accepted type (you can also drag one in).
3. The viewer hands the bytes to this service. The service sends a base64 copy
   to `python.run`, Biopython reads it as `snapgene` and writes `genbank`, and
   the viewer opens the returned record with its features and topology.

## How it works

| File | Role |
| --- | --- |
| `plugin.json` | Declares `service.fileConversions: dna → gbk` and the `python` permission. |
| `index.html` | Script host, **not a page** — nothing but `<script>` tags, renders nothing. |
| `hikari.js` | Sends the permission-gated `python.run` host call. |
| `biopython-converter.js` | Encodes input bytes, supplies the Biopython program, and validates its GenBank readback. |
| `main.js` | Listens for the host's conversion request and replies with GenBank. Touches no DOM. |

There is no HTML, CSS, or DOM code here beyond the script host: a service is
headless, and the host mounts its frame hidden and pinned to `display: none`.

The host calls the service over `postMessage` (host → service, the reverse of
the [host API](../../../docs/plugins/plugin-api.md)); the service receives only
the selected file's raw bytes. Its separate host call can invoke only the
manifest-declared Python capability. See
[docs/plugins/service-plugins.md](../../../docs/plugins/service-plugins.md).

## Scope

Biopython's SnapGene reader supplies the sequence, topology, features, primers,
and supported qualifiers. Hikari's Python API accepts at most 4,000,000 input
characters and returns at most 60,000 characters per readback file, so the
service rejects unusually large inputs or GenBank outputs instead of silently
truncating them.
