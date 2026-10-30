# Gel Analysis plugin

This is Hikari's Gel workspace. Its source lives under `src/plugins/gel` and
ships with the application, but it loads as a plugin rather than a renderer
module. It remains a full workspace: image/TIFF ingestion,
crop and free rotation, enhancement, lane segmentation, ladder calibration,
band quantification, band integration, reports, saved records, and CSV export.
Generated PNG figures use up to 4× raster density for publication-scale text,
and PowerPoint export keeps the lane table as an editable native table. A
one-row table exports as lane captions rotated 45° (editable text in PowerPoint),
in individual gels and in Stack alike.

Enable **Export → Ladder labels** to add marked ladder sizes beside an exported
PNG or PowerPoint clip. It defaults to off and applies to both individual gels
and Stacks. Only ladder marks inside each gel's crop are labeled; every Stack
row uses its own marked positions and image scale. Labels and ticks remain
editable in PowerPoint. Units follow the selected protein, DNA or RNA ladder.
This export option does not change measurements or mark the gel as unsaved.

## Gel layers and Stack

The left rail lists each gel once, either outside the stacks or nested inside one.
Its Gels header and add buttons stay fixed while the entries scroll, matching
the DNA and Notebook file trees. The shared compact rows truncate long names;
the scroll region reaches the rail's right and bottom edges.
New workspaces start without a Stack. **Add stack** creates an empty Stack
immediately. Drag gels into it when ready. Each click
creates a new stack without replacing the existing ones. Every stack has its own
name, Layout name, and trim. Empty Stacks can be
renamed, saved, reopened, and filled by dragging gels into them;
an existing Stack remains available if you move all of its gels out.
Drag a gel onto any stack to move it there, or into the top-level gel area to move it out.
The tree scrolls when a drag approaches its top or bottom edge.
Drop before or after another gel to reorder. Alt+Right moves a focused gel into
the most recently opened stack; Alt+Left moves it out. Moves preserve processing, placement, and image
data, and support undo/redo and project saving. The rail has no image previews.
The header’s **Add gel** and **Add stack** icon buttons have hover labels. Choose
**Add gel → Current gel** to capture the gel you are editing, or **Add gel → Image files…** to import images (up to 16 layers). You can
also drop one or more image files onto the layer list or preview to add layers.
Dropping onto the processing canvas or using its image picker also adds each
gel to the navigator. Canvas drops open the first valid image for processing
and keep earlier gels and their settings available in the rail.
Image imports automatically use the configured Gel storage to save the original
file, decoded source, preview, metadata, and record index. Processing and saving
an imported gel updates that record. If storage fails, the image stays in the
workspace and the import reports the error.
In **Lanes → Dividers**, drag anywhere along an existing divider to reposition it.
The grab zone extends 12 screen pixels to either side, regardless of image scale;
the nearest divider wins in crowded lanes. A drag preserves its initial pointer
offset, stops before neighboring dividers, and forms one undo step. Right-click
uses the same grab zone for **Remove divider**.
The empty preview includes a file picker. **Add stack** needs just one click. The rail has
no selection checkboxes. The canvas stays in the
center. The far-right vertical icon toolbar groups Image, Crop, Lanes, Ladder, Bands,
and Results; a Layout icon joins them only while a Stack is open, because a
single gel has no layout. One category panel opens to its left; click its icon again
or close the panel to hide its contents. The gel keeps its size and position.
Processed, Export, and Save
remain directly available as icons. Each icon has a short
caption under it, and arrow keys move through the toolbar. Stack selection shows Layout; select a gel to use
its processing tools. Cropping keeps its controls visible until Done or Cancel.
New layers are named Gel 1,
Gel 2, and so on. Rename a gel with **Gel Name** in its Image tools, or
double-click a Gel, Stack, or Layout entry to rename it directly in
the rail (F2 also works). Enter or clicking away saves; Escape cancels; a blank
name keeps the previous name. Names support undo/redo and project saving. The gel name is
also the antibody caption in the figure. Drag gels in the rail to reorder them.

Create a stack with **Add stack**, then drag gel entries into it. The **Stack** entry
previews those gels in layer order inside the current Gel viewer. Its nested
entries open each gel for processing, while **Layout** returns to the Stack.
The navigator and right-side actions stay visible. Clicking any gel entry
opens its analysis tools; without a Stack, imports and opened projects go
straight to the gel editor. In the Stack, the **Export** menu's image and
PowerPoint entries export the Stack.
Drag gels between stacks to change their membership.
Dragging changes membership immediately. Gels moved out remain available at the
top level; new imports also appear there until moved into Stack.

In Stack, **Set trim edges** opens the full canvas with two vertical handles.
Drag the left and right edges to choose the area to keep; the discarded margins
are shaded. You can also click near an edge to place it, or use arrow keys on a
focused handle (Shift moves farther). **Apply trim** or Enter keeps the area;
**Cancel** or Escape leaves the previous trim intact. **Adjust trim edges**
reopens both handles, and **Reset trim** restores the full image. The same edges
trim every blot and its individual lane table. Projects, PNG/PPTX exports, and
undo/redo preserve the chosen edges; individual gel images remain available.

Arrange blots directly in the Stack preview: drag
a blot to slide it (in the Stack, drag it up or down past another blot to
reorder), drag its top or bottom edge to crop it, and drag a side
to resize it (the other side fixed) until its lanes line up with
the other blots. Resize an individual gel directly with its canvas
side grips. Width and height scale together, preserving its aspect ratio and crop.
Resizing supports undo/redo, project saving, and both exports.
Saved records appear in the same navigation tree, with images loaded when opened
or dragged into Stack. Records already open are matched by their saved ID so they
appear once. Unopened records do not consume the figure's layer allowance.
Opening a saved gel keeps its place in the rail and does not create unsaved work.
Renaming, processing edits, and deliberate layer moves still participate in
project saving and undo/redo; switching the processed preview is view state.
Use **Add gel → Recover saved gels** to recover artifact folders missing from the
record index. Recovery keeps existing records, adds each missing ID once, and
leaves the saved files intact. It runs only when requested, so normal startup
does not bring back records removed from the index.
Lane detection or existing dividers give the
starting position; drag a blot to move it, a side grip to resize it, or its
top or bottom edge to crop it. The figure
translates and uniformly scales each intact blot; it does not rearrange lanes
or warp individual bands. Use **Lanes → Auto-detect** to detect lanes in the
individual gel.

**Export → Image (PNG)** produces a white figure at up to 3× density.
**Export → PowerPoint (PPTX)** exports the active gel or Stack to one slide
with separate blot images and editable antibody labels on the left.
**Save project** in the toolbar downloads a `.gel-figure.json` file containing all layers,
their names, all stacks and their layout settings, selection, normalized original images,
processing settings, and placement; it preserves 16-bit intensity data.
**Add gel → Project…** merges its layers and stacks while retaining current edits.
Reopening the same project reuses existing entries; library records are reconnected
only when the saved image agrees. Version 4 retains stable identities and record
references; versions 1–3 still open.

The workspace automatically saves stacks (including empty stacks), membership,
order, names, layout settings, images, processing and individual tables to the
configured storage folder. It restores on startup without opening a project
file. Undo and redo are also saved. Browsing alone stays clean. Quit's Save
flushes pending workspace changes without a download dialog; **Save project**
remains a portable backup. Failed writes remain unsaved and can be retried.

A single gel and a Stack edit their lane table the same way: a **Lane table**
bar (**Add table**, then **Add row** and **Remove row**, which removes the last
row) above a white strip where labels and lane values are typed in the export's
own type and position, so what you type is what exports. A single gel's strip
sits above its image over its own lanes; its bar also has **Include ladder
lane** and × (hide; **Lanes → Table** shows it again), and a long table scrolls
in the strip. **Add table** asks for finished lane dividers when they are
missing. A Stack has one overall table of its own, typed on the top of its
figure over the lanes of its first gel with lane dividers. While a
Stack has this table, its gels' own tables are left out of the Stack; without it,
each gel's own table sits directly above its image and follows its gel when
moved, resized, cropped, or reordered. A one-row table is drawn as lane captions
rotated 45° instead of table cells. PowerPoint keeps multi-row tables as editable
table cells and captions as editable rotated text. Obsolete shared-header
selection settings in older projects are ignored.

The main workspace stays on the gel image. The right editing panel groups tools by
function: **Image** (name and analysis type), **Processed** (denoise and contrast),
**Lanes**, **Ladder**, **Bands**, and **Results** (the band
intensity window, the lane profile, and the band integration window). Sections are
not steps; open whichever you need. The **Processed** icon opens both enhancement
sliders and previews their effect. Its **Processed view** switch compares the
result with the original; closing the panel keeps the chosen preview and settings.
Clicking the gel only does something while
a tool is pressed (Dividers, Vertices, Pick lane, Set MW, Top, Bottom); with no
tool pressed a click does nothing. Pick lane releases after its click, Top
hands off to Bottom, and in **Per lane** mode Bottom hands back to Top until
every lane has a window. The ladder is optional: **Detect** and **Set MW** stay
disabled until a ladder lane is picked, and results appear as soon as the band
window is set. Right-click a divider while placing dividers and choose
**Remove divider** to delete it; undo restores it. While dividers are being placed, **Finish dividers** leads the
tools panel. Completion and error messages use Hikari's overall notifications.
Progress does not create a notification. A failed operation with a retry action
adds **Try again** to the **Add gel** menu. The **Crop** icon opens crop mode, as in photo editors: drag the
edges on the image, and the Crop panel holds **Straighten** (±45°), **90°**,
**Reset**, **Cancel**, and **Done** (Enter keeps the crop, Esc cancels). Reset shows the full original image again; nothing
changes until Done. **Reset** is a toolbar icon that clears lane and band
selections and supports undo. **Save** stays below the tools.
**Band intensity** opens a floating window with a bar graph above the measurement
table. **Copy table** copies the headers and every row for pasting into a spreadsheet.
Quantification uses the original image, independently of preview denoise and
contrast. Automatic background connects nearby stable profile strips outside
the selected band. In the **Band integration**, place both baseline ends outside the
highlighted band to use that line instead; the smallest spanning baseline in
that lane takes priority. Clearing it restores automatic background. The dashed
line shows the background used for the highlighted measurement.
Negative net intensity is retained and marked **Review background**. A band
covering the entire image has no automatic background and displays **–** until
a manual baseline is available. One-sided background is also marked for review.
CSV reports include the baseline method, status, background sum, and signed net
intensity. Saved reports with source pixels are recalculated when reopened.
Band intensity and the band integration window can be moved by dragging their title bars,
or by focusing the title bar and using the arrow keys (Shift moves farther).
Escape closes the front window.

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
| `notifications` | Sends completion and error messages through Hikari's shared notification system. |

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

Workspace snapshots live separately in `Plugins/gel/Workspace/`. Two rotating
chunk slots keep writes within the host file limit and bound disk use. The atomic
`current.json` manifest commits only after every chunk succeeds; `previous.json`
retains the prior snapshot. Restore checks hashes and falls back to that snapshot
if necessary. Failed restoration preserves the saved files and blocks autosave
from replacing them with an empty workspace.

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
