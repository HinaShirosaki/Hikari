# Gel Analysis plugin

This is Hikari's Gel workspace, now owned and shipped as a bundled plugin rather
than a renderer module. It remains a full workspace: image/TIFF ingestion,
crop and free rotation, enhancement, lane segmentation, ladder calibration,
band quantification, peak editing, reports, saved records, and JSON/CSV export.

## Distribution and permissions

Gel is bundled with Hikari and appears automatically in **More**. It uses the
ordinary served-plugin runtime and can be turned Off in Settings, but it cannot
be removed. The packaged folder is resolved by the host through the private
`@bundled/gel` token; the iframe never receives an application path.

Its public permissions are intentionally small:

| Permission | Use |
| --- | --- |
| `storage` | Compact versioned index of saved Gel records. |
| `files` | Source/preview images, report JSON, and record metadata under the plugin's own folder. |
| `downloads` | Native save dialog for JSON and CSV exports. |

Gel does not request notebook, project, sample, or protocol access. The old
renderer integration points that cannot cross a plugin boundary—Notebook
"Add Gel", linked-gel live previews, agent tools, and `/gel` topbar search—are
not recreated as broad permissions.

## Host adapter

`main.js` adapts the workspace to the generic plugin API:

| Workspace dependency | Plugin implementation |
| --- | --- |
| Plugin-owned `state.gelAnalyses` | Hydrated from a compact `storage` index plus JSON artifacts in `files`. |
| `persist` | Awaited `storage.set`; a record is marked saved only after the host acknowledges it. |
| disk artifact methods | `files.write` / `files.read`, namespaced below `Plugins/gel/`. |
| JSON/CSV export | `downloads.save`, which opens a user-controlled native save dialog. |
| theme and font size | Initial `app.info` snapshot plus `app.context` updates. |
| storage availability | Safe `storage.configured` boolean; the path itself is never exposed. |

The iframe still provides its own DOM and loads the Gel workspace module from
`vendor/modules/gel/`. Plugin-specific fixes belong there now; it is not a
verbatim mirror of a renderer source tree.

## Persistence shape

Saved artifacts live under:

```text
<storage root>/Plugins/gel/Gels/<name>__<id>/
├── source.png
├── preview.png
├── analysis-result.json
└── gel-record.json
```

The `storage` blob keeps only the fields needed to list and locate each record.
On load, `main.js` hydrates metadata and report content from the JSON files. A
failed artifact write or failed index write leaves the record visibly unsaved;
there is no silent inline-image fallback into the 1 MB plugin blob.

On the first run with configured storage and no Gel plugin index, the host can
copy legacy renderer Gel records and their artifacts into this namespace. That
compatibility hook is restricted to the bundled Gel identity and is not a
permission third-party plugins can request. Existing host records are not
deleted.

## Failure and recovery behavior

The iframe starts behind a visible boot status and only reveals the workspace
after the host handshake, markup load, persisted-record hydration, and
controller initialization succeed. Boot failures show the actual error and a
Retry action. Missing optional analysis libraries show a warning without
hiding the usable workspace.

Save is exclusive: a repeated click shares the in-flight promise, the form is
marked busy, and success appears only after all artifacts and the compact
index are acknowledged by the host. Form editing, reset, and record switching
stay locked during that commit so the acknowledged record matches the visible
draft. Artifact failures leave the record
unsaved. Delete is also deduplicated and confirms that only the record entry is
removed; plugin files remain because the public API intentionally has no
delete verb.

The controller owns and releases its drop, pointer, mouse, crop, and timer
resources through `destroy()`, so a retry or reload does not accumulate UI
listeners. Storage-context refreshes use a request token so an older async
hydration cannot overwrite newer state.

## Why `serve: true`

The workspace uses ES modules. A local opaque-origin frame cannot fetch relative
module imports, so Hikari serves this bundled folder on a plugin-specific
loopback origin. The server is process-local, rooted at this folder, and still
runs inside the plugin iframe sandbox.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the controller and analysis layout.
