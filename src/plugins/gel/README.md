# Gel Analysis plugin

This is Hikari's Gel workspace. Its source lives under `src/plugins/gel` and
ships with the application, but it loads as a plugin rather than a renderer
module. It remains a full workspace: image/TIFF ingestion,
crop and free rotation, enhancement, lane segmentation, ladder calibration,
band quantification, peak editing, reports, saved records, and CSV export.
Generated PNG figures use up to 4× raster density for publication-scale text,
and PowerPoint export keeps the lane table as an editable native table.

## Gel layers and Stack

Open **Layers** and choose **Add → Current gel** to capture the gel you are
editing, or **Add → Image files…** to import images (up to 16 layers). New layers are named Gel 1,
Gel 2, and so on. Select a layer and edit **Layer name** to name it after the
antibody; double-clicking its name focuses the rename field. That name is
also the antibody caption in the figure. **Process gel** returns to the
existing crop, rotation, enhancement, and lane tools with that layer's settings.

Check the gel layers to combine and click **Stack**. The **Stack** entry
previews those gels in layer order inside the current Gel viewer. The rail and
the viewer toolbar stay visible. Clicking a gel previews it on its own.
The **Export** menu's image and PowerPoint entries use the active layer or Stack;
using an individual processing control resumes that gel in the same viewer.
Changing the checkboxes or adding gels leaves the existing Stack intact until
Stack is clicked again. Excluded layers remain available for individual editing.

In Stack, **Trim excess** crops every blot to their shared horizontal area so
the left and right image edges match. Adjust **Left edge (%)** and
**Right edge (%)** to refine the crop, or use **Reset trim** to restore the
full margins. The crop shifts the shared lane table and guides together with
the blots, preserving their alignment. Automatic trim follows later changes
to the Stack's gels and alignment. Trim is included in PNG/PPTX exports and
saved projects; individual gel images and their processing remain available.

Arrange blots directly in the preview, in a single layer or the Stack: drag
a blot to slide it (in the Stack, drag it up or down past another blot to
reorder), drag its top or bottom edge to crop it, and drag a side
to stretch it (uniformly, the other side fixed) until its lanes line up with
the guides and the other blots. Lane detection or existing dividers give the
starting position; **Reset alignment** returns to it, and **Exact values**
shows the same first/last lane anchors and crop as numbers. The figure
translates and uniformly scales each intact blot; it does not rearrange lanes
or warp individual bands. The shared lane guides help check alignment and
never appear in exports.

**Export → Image (PNG)** produces a white figure at up to 3× density.
**Export → PowerPoint (PPTX)** exports the active gel or Stack to one slide
with separate blot images and editable antibody labels on the left.
**Save project** downloads a `.gel-figure.json` file containing all layers,
their names, Stack membership, selection, normalized original images,
processing settings, and placement; it preserves 16-bit intensity data.
**Add → Project…** appends its layers so existing work is retained.
Projects are saved explicitly through the native file dialog, separately
from Existing Gels.

The editable lane table sits above the image in the individual editor, with
columns aligned to the gel lanes. In Stack, **Lane table** selects the
included gel whose table forms a shared header above the entire stack (the first
available table by default). Its columns follow that blot's alignment transform
in the preview and both exports. PowerPoint retains editable table cells.

The main workspace stays on the gel image. The rail groups every tool by
function in collapsible sections: **Image** (file, analysis type, crop,
denoise, contrast), **Lanes**, **Ladder**, **Bands**, and **Results** (the band
intensity table with Copy, the lane profile, and the peak editor). Sections are
not steps; open whichever you need. Nothing sits above the gel: a small card
at its top right holds the pending finish action (**Finish dividers**, **Done
Ladder MW**, **Done Quantify**), the **Processed** switch, an **Export** menu
(PNG, PPTX, CSV), and **Layers** with its layer count. Status text goes to
screen readers only. **Crop** opens crop mode, as in photo editors: drag the
edges on the image, and the card holds **Straighten** (±45°), **90°**,
**Reset**, **Cancel**, and **Done** (Enter keeps the crop, Esc cancels). Reset shows the full original image again; nothing
changes until Done. **Save** stays at the bottom of the rail beside
a menu with **New gel** and **Reset lanes and bands**. The peak editor is the
only floating window: drag its title bar, or focus the title bar and use the
arrow keys (Shift moves farther); Escape closes it. The lane table scrolls
within its panel above the gel.

## Distribution and permissions

Gel is bundled with Hikari and appears automatically in **More**; users do not
install its source folder. It uses the ordinary served-plugin runtime and can
be turned Off in Settings, but it cannot be removed. The packaged folder is
resolved by the host through the private `@bundled/gel` token; the iframe never
receives an application path.

Its public permissions are intentionally small:

| Permission | Use |
| --- | --- |
| `storage` | Compact versioned index of saved Gel records. |
| `files` | Source/preview images, report JSON, and record metadata under the plugin's own folder. |
| `downloads` | Native save dialog for CSV, generated PNG, and editable-table PowerPoint exports. |
| `layout` | Commits the in-frame left rail's settled width to Hikari's shared layout preference. |

Gel does not request notebook, project, sample, or protocol access, so the
plugin cannot open or mutate those host features. Host-owned readers may still
show saved Gel records in notebook, project, PDF, or Agent surfaces by reading
the plugin's persisted record index; that one-way display path does not grant
the iframe another capability. Old action hooks such as Notebook "Add Gel" and
`/gel` record search are not recreated as broad permissions.

## Host adapter

`main.js` adapts the workspace to the generic plugin API:

| Workspace dependency | Plugin implementation |
| --- | --- |
| Plugin-owned `state.gelAnalyses` | Hydrated from a compact `storage` index plus JSON artifacts in `files`. |
| `persist` | Awaited `storage.set`; a record is marked saved only after the host acknowledges it. |
| disk artifact methods | `files.write` / `files.read`, namespaced below `Plugins/gel/`. |
| CSV/PNG/PPTX export | `downloads.save`, which opens a user-controlled native save dialog. |
| theme and font size | Initial `app.info` snapshot plus `app.context` updates. |
| shared left-rail width | `app.info.layout.leftRail` initializes the in-frame rail; `app.setLeftRailWidth` commits a settled drag and synchronizes normal modules. |
| storage availability | Safe `storage.configured` boolean; the path itself is never exposed. |
| undo and redo | The workspace keeps its own stack over `manualOverrides`; `app.setHistory` reports its depth so the host's global buttons light up, and the host sends `app.undo` / `app.redo` back to this frame. Cmd+Z inside the frame is handled here, because a focused frame's key events never reach the host document. |

The iframe still provides its own DOM and loads first-party Gel code from
`workspace/`. The `vendor/` folder is reserved for third-party browser assets
and the generated host-style snapshot used by the isolated iframe. Small host
helper snapshots live in `lib/`; the Gel selfcheck keeps those copies byte-for-
byte aligned with their renderer owners. The PowerPoint compatibility writer is
bundled under `vendor/pptxgenjs/` with its upstream license so export does not
depend on Electron or Node module resolution inside the sandbox.

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

The workspace uses ES modules and retains its explicit `serve: true` manifest
flag for compatibility. Hikari now serves all installed local folders on their
own loopback origins. The server is process-local, rooted at this folder, and still
runs inside the plugin iframe sandbox.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the controller and analysis layout.
