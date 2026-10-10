# Figura

Install this folder using **Settings → Skills & plugins**, enable it and reload.
The **Figura** workspace then appears under **More**. Configure Hikari storage and sign in to Codex,
enter a figure description, and click **Draw with Codex**. Progress appears in
the workspace's chat rail. Each illustration has its own conversation and
Codex session, separate from other figures, paper and Assay chats. Switching
figures restores their chat histories and unsent chat drafts. New and duplicate
figures start with empty chats. The rail shows no prefilled prompt suggestions.
Messages show only your description. Canvas targeting and drawing rules are
provided separately through Hikari's agent context and the canvas contract.

You can also start from a saved protocol or paper passage. Use **Protocol → … →
Generate illustration**, or select text in a paper PDF and choose **Generate
illustration** in its hover toolbar. Each action opens a new figure and its own
chat. The plugin saves the protocol or the selected passage, page and available
paper Markdown alongside the figure, so Codex can use that context on later
edits. Missing or truncated Markdown is disclosed to the agent. Existing figures
are preserved. These entry points require a Hikari host with the context-action
API; older hosts still support drawing from the plugin's own composer.

The **Illustrations** left rail contains saved figures. Use **+** to create
one, the title field to rename it, and **Figure options → Duplicate illustration** to copy
the entire figure. Search filters titles; selecting a row opens its main and
scratch contents. Each illustration saves independently. Your existing figure
is added to this library automatically. The canvas uses the full editing width
when a figure opens. The **Layers / Assets** buttons in the right toolbar open
either panel in the shared rail beside it. Click the active button again or
the panel's **Close** button to return that space to the canvas. At
narrow widths this panel overlays the canvas and scrolls independently. The UI
follows Hikari's day/night appearance and font scale. The tools share one outer
strip with the folded agent chat toggle. Opening a
component panel folds chat, and opening chat folds the component panel. Older
Hikari builds retain a compact local right toolbar. The plugin uses Hikari's
shared left rail width. Drag the rail divider to resize. Use the chevron
beside the figure title to hide or show **Illustrations** and give the canvas
more room. Hikari saves the
folded state per plugin through `app.setLeftRailFolded` (the `layout` permission).
On older Hikari builds the toggle stays hidden until this API is available.
An existing installation without `layout` permission needs the folder re-added
to grant it.

The main canvas defaults to 1200 × 800; scratch defaults to 500 × 350. Both
are editable SVG scenes with independent vector, raster, and text objects.
Scratch is hidden by default. The agent summons it only when useful for complex
components; you can also use **Scratch** in the right toolbar.
Use **Close** to hide it. Closing preserves its objects, and the agent can read,
edit, and render both canvases while it is hidden. Opening another illustration
or reloading starts with scratch hidden again. Selecting a scratch layer or
copying a component to scratch opens it for manual work.
Select objects on a canvas or in the layer list; drag to move and use the
eight handles to resize. Vector and raster artwork stretches with the box:
corners adjust both dimensions, edge midpoints adjust one dimension.
Text keeps a fixed aspect ratio with every handle; its box and font scale together.
Changing a text layer's Width or Height also scales both dimensions and its font.
The font-size control remains independently editable.
Text selection outlines and click targets fit the rendered label, so blank
space in its layout box does not interfere with nearby components. Alignment,
anchoring, and saved placement remain unchanged.
The opposite corner or edge midpoint stays fixed, including rotated
objects. Arrow keys nudge, Shift nudges by ten pixels; Escape clears selection.
Drag the round handle connected to the selection frame to rotate around its
center. It works on artwork, text, groups, and multiple selected components in
both canvases. Hold Shift to snap to 15° increments. Escape cancels rotation
without changing the figure; releasing the pointer saves one undoable edit.
Text rotates around its visible bounds while keeping its font and layout size.
The handle keeps a fixed screen size and moves to an available edge when needed.
Focus the rotation handle and use arrow keys for 1° steps, or Shift for 15° steps;
Enter or Space rotates 15° clockwise.
Use **Ctrl+C / Ctrl+V** (or **⌘C / ⌘V** on macOS) to copy and paste selected
components, multiple selections, or complete groups. Paste targets the active
canvas, including Scratch or another illustration, and selects the new copies.
The copied snapshot keeps the original artwork, independent text, styling,
rotations, layer order, and full group membership even if the source is later
edited or deleted. Copies get fresh IDs and a 15-pixel cascading offset; each
paste can be undone in one step. Text-field shortcuts retain normal text editing.
Native clipboard events carry editable Figura data. When a browser clipboard
command is unavailable, the editor keeps a private copy buffer until reload.
Use **− / +** to zoom and **Fit** to show the whole canvas. Scroll to pan when
zoomed, or hold **⌘ / Ctrl** while scrolling to zoom at the pointer. Zoom applies
to the active canvas; main and scratch keep separate views. Saved geometry,
exports and agent readbacks keep their original canvas coordinates. Handles
retain their screen size at every zoom. Layer rows show component previews and a visibility button
on hover or keyboard focus. Main and scratch layers are grouped separately.
Use **Add layer (+)** in the right toolbar for text labels, vector components,
or imported artwork.

Use the right toolbar to choose **Select & move** (V) or **Freehand select** (L).
Select & move combines rectangle selection,
movement and resizing in one tool: drag empty space to select an area, drag a
component to move it, and drag a resize handle to adjust its size. Dragging one
member of a selection moves all its selected components together.
Drag to outline components on the main or scratch canvas; a freehand path
closes automatically on release. Components whose boxes touch the region are
selected, including rotated components. Hidden standalone layers are excluded.
Groups select together; hold Alt to select only the touched members. Each selected
component has its own outline; the outer frame moves and resizes the full selection.
Shift adds to the current selection. Escape cancels a gesture and keeps the
previous selection.
Freehand selection also allows dragging selected components to move them.
Resize handles work in both tools, so there is no need to switch tools after selecting.
The region is temporary and never appears in exports or agent readback.

The inspector shows the selected component's relevant controls first. Select a
canvas object and open **Layers** from the toolbar, or select its layer row. Selecting or dragging
on the canvas keeps the current panel layout steady. Double-click a label to
open its independent text controls, then use the compact font,
size, color, bold/italic/underline, alignment, weight and anchor controls.
Rotation and opacity stay visible; expand **Position & size** for exact
coordinates, dimensions and canvas membership. Vector source and fill/stroke
overrides are editable; clearing an override restores the original SVG style.
Raster artwork can be replaced. Layer actions duplicate, reorder, delete, or
copy the selection to the other canvas. No label is part of an artwork asset.

For an empty illustration with chat closed, describe your figure in the compact
composer beneath the canvas. Click the arrow or press **⌘Enter / Ctrl+Enter** to
send it to Codex. Once either canvas contains a component, use the agent rail's
input for changes; the bottom composer stays hidden even when chat is folded.
Opening the agent rail also hides the starting composer. Folding chat restores
it and any unsent canvas draft only while both canvases are empty. Complexity remains in the top toolbar
throughout. The canvas remains
visible while scrolling a long property panel. Use Hikari's system Undo and Redo
buttons; they enable only when the focused Figura editor has history available,
including edits made from the shared toolbar. Figura's toolbar has no duplicate
history icons. ⌘/Ctrl+Z undoes, ⌘/Ctrl+Shift+Z or Ctrl+Y redoes. Text fields keep
their native text undo. The top toolbar holds the compact title field,
active canvas and size controls; zoom, Fit and Scratch are in the right toolbar.
In narrow workspaces, canvas controls wrap within the same toolbar.
The canvas-size dropdown offers Landscape,
Portrait, Square, Widescreen and Small presets. Select **Custom…** for exact
width and height; the adjacent options button also opens size/background
settings. These controls apply to the active canvas: select its heading or a
layer first. Resizing changes the canvas bounds while preserving object
coordinates and sizes; it does not scale the artwork. Undo restores the prior
canvas size. Agent edits and saved custom sizes appear in the dropdown too.

The toolbar offers three **Complexity** levels, saved per illustration:

- **Simple:** essential shapes, relationships and labels, with minimal visual detail.
- **Standard:** recognizable components and useful internal features, with balanced detail.
- **Detailed:** relevant substructures, stages and annotations, organized with insets or panels when useful.

Codex forms an illustration brief using the selected level before drawing.
All levels preserve requested content and scientific accuracy, prefer SVG,
keep labels separate and use scratch only when needed. Changing the level
guides the next request; it does not redraw existing artwork automatically.
Existing figures default to Standard. The canvas surround has no separate fill.

Use scratch for complex components, then copy individual objects or all its
objects to main. Copied objects remain independent and the scratch originals
are retained. Layer ordering, visibility, duplication, deletion, undo/redo,
canvas sizes and background colors are available. **Export → SVG** keeps artwork
and text in separate SVG groups; **Export → PNG** exports the assembled main canvas.
**Export → PowerPoint** creates one slide matching the main canvas. Every visible
component remains a separate object you can move, resize, rotate, or delete in
PowerPoint. Labels are editable text boxes; SVG artwork remains vector graphics,
with a PNG fallback for older readers, and raster artwork remains individual
images. WebP images are converted to PNG. Canvas groups export as independent
members in their original layer order. Scratch and hidden layers are omitted.
PowerPoint uses fonts installed on the computer opening the file. Editing paths
inside an SVG component requires PowerPoint's **Convert to Shape** feature;
imported raster pixels remain images.

Artwork SVG is validated with a DOM allowlist. It rejects text, foreign
objects, image embeddings, scripts, event attributes, styles, unresolved and
external references. Local gradients, shapes, groups, clipping and masks are
supported. Imported IDs are namespaced per object when rendered. Agents must
also avoid converting text to paths; glyph-shaped paths cannot be reliably
distinguished from legitimate illustration geometry.

Placement honors the SVG source's aspect ratio (`xMidYMid meet` by default).
Manual resizing with a handle or a Width/Height field deliberately sets the
SVG root's `preserveAspectRatio` to `none`, so the artwork stretches along with
the box rather than leaving proportional artwork inside a changed viewport.
This source change is saved with the geometry, visible to Codex and included
in previews and exports; undo restores both. Agents can request free stretching
by using `preserveAspectRatio="none"` in their SVG source. Coordinates use canvas units at the unrotated box's
top-left, with clockwise rotation about its center. Scratch transfers keep
these coordinates and dimensions. Logical object IDs stay stable; rendered
IDs are isolated from other components, layer previews and editor controls.

Artwork colors do not inherit the editor's day/night theme. SVG `currentColor`
defaults to black; an explicit SVG `color` attribute overrides it. Inter labels
use fixed typography at every canvas scale, and the bundled font is embedded
in SVG exports and MCP previews. Labels remain editable text. Other fonts
still require the corresponding system font on the machine displaying an SVG.
The plugin reads Inter from its own local asset server when exporting; it
does not contact an external font service.

Codex chooses the renderer separately for each component:

| Appearance or requirement | Renderer |
| --- | --- |
| Schematic cells, membranes, receptors, vesicles, DNA cartoons, abstract protein shapes | SVG |
| Arrows, connectors, panels; exact counts, positions and connections | SVG |
| Quantitative charts, scale bars, precise atom/bond geometry | SVG from known values or verified structure |
| Realistic anatomy, organic surface detail, dense textures, photographic lighting | Codex `image_gen` when simple SVG cannot express the required appearance clearly |
| Labels, titles and annotations | Separate editable text objects |

A detailed schematic mitochondrion can remain SVG. A realistic textured
mitochondrion portrait can use image generation, with its labels and arrows
added independently. Simple / Standard / Detailed controls detail, not renderer
selection; a large number of objects does not justify rasterizing the figure.

Open **Figure options (⋯)** and turn on **Image generation** to choose
0%, 25%, 50%, 75% or 100%. Off keeps Automatic SVG-first choice; 0% disables new
image generation. The percentage describes the approximate visual area of
eligible illustrative artwork, excluding boxes, arrows, connectors, panel
frames, charts, scale bars, exact scientific geometry and text. Those always
remain separate SVG or text objects, even at 100%. It is a preference, not
an exact pixel measurement or a quota of components/calls. A fully schematic
request stays SVG rather than adding unnecessary texture to reach a target.
The setting belongs to this illustration, survives reload and duplication,
and guides subsequent requested edits without converting existing artwork.

| Target | Agent guidance |
| --- | --- |
| 0% | SVG only; no new image generation. |
| 25% | Mostly SVG; image generation for key organic or textured detail. |
| 50% | Balanced visual shares of SVG and image-generated illustrative artwork. |
| 75% | Mostly image generation; SVG for simpler illustrative components. |
| 100% | Image generation for all eligible artwork; schematic geometry stays SVG. |

If the choice is uncertain, Codex renders one simple SVG draft at final size.
It keeps a clear, recognizable draft or switches that component to image
generation when the requested natural appearance remains inadequate. An
obvious raster need can go straight to generation. Hybrid figures combine
independent raster and SVG layers. Any part requiring its own movement or
restyling must have its own layer; pixels inside a raster object cannot be
edited individually. Generated artwork cannot establish measured data or exact
molecular structure.

Generated components are text-free and use transparency where appropriate.
These rules are included in the submitted drawing prompt and the full canvas
contract Codex reads. Hikari enables native image generation for
canvas chat turns. The plugin uses Codex's signed-in access and requires no
separate image provider or API key. The agent imports the exact native output
path with `assets:[{id:"component",source:"codex",path:"absolute-output-path"}]`.
Only the managed Codex `generated_images` folder is accepted; importing embeds
the image bytes in the saved illustration, so the figure survives deletion of
the temporary original. If the running Codex has no native image-generation
tool or generation fails, it must explain the limitation and use suitable SVG
or user-provided raster artwork. It must not switch providers. Every raster import
requires confirmation that it contains no baked-in text; this is a visual
inspection requirement, not an OCR guarantee. PNG, JPEG, WebP, up to 5 MiB
per asset and 64 megapixels decoded.
There is no per-request asset-count or combined-import-byte quota, or plugin
quota on native image-generation calls. Saved scene/file size limits remain.

Before completing a drawing run, Codex must render both canvases and review
placement, clipping, labels, artwork and scientific relationships. Scratch
stays hidden while being rendered. The agent records its observations through
`inspect`; a render alone is insufficient. Any subsequent edit, undo/redo,
reload or new run requires another inspection. Hikari gives a skipped
inspection one automatic follow-up, then reports the run as incomplete if
the review is still missing. Saved artwork remains available for editing.
This enforces a visual review workflow; the review can still contain mistakes
or scientific uncertainty.

## Agent tools

### Reusable components

Select one layer, a group, or several layers on one canvas. Choose **Save as
asset…** in Layers, or **Figure options → Save selection as asset…**, and give
it a name. The **Layers / Assets** buttons in the right toolbar open either panel;
clicking its active button again closes the rail. Only one panel is visible
at a time. **Assets** provides searchable
previews. Click an asset to place an editable
copy on the active canvas. Large assets fit within 70% of the destination;
smaller assets keep their saved size. Copies get fresh IDs and keep their
rotations, relative positions, paint order, raster bytes, and text formatting.
Multiple components form one named group with independently editable children.
Remove an asset with its trash control; already placed copies are retained.

Use **Assets → Import asset…** to save an SVG, PNG, JPEG, or WebP file directly
to the library. Give it a name in the preview. Raster imports require the same
text-free review as canvas artwork; SVG keeps its editable vector form.

Place a raster asset on Main or Scratch, select the image and click **Crop selected image** in the
toolbar. Drag the crop handles directly in the canvas or enter pixel bounds,
then choose **Apply crop**. No crop dialog opens. **Reset** restores the full source
crop. Cropping preserves transparency and saves embedded PNG bytes. It keeps
the retained pixels in place, including on stretched or
rotated layers. Undo restores the original image and geometry; Cancel or Escape
discards the crop. The original saved asset stays intact; use **Save as asset…**
to save the cropped selection as a new reusable component. Imported assets and
cropped images survive plugin reloads.

Saved assets are shared across this plugin's illustrations and survive reloads.
They live in the selected Hikari storage root, rather than inside the installable
plugin folder. Saving captures a snapshot: subsequent source edits do not update
the asset. To save a revised version, save the edited components under a new name.

The current canvas `read` includes `reusable_assets` metadata and
`assets_revision`. The agent can use these requests through `plugin_canvas`:

Every new drawing or edit starts with `asset_list`, including an empty library.
The plugin blocks agent mutations until this check is made in the current run.
Codex reads and previews relevant candidates before deciding whether to reuse,
adapt or generate a component. Compatible reuse preserves the figure's renderer
rules, style, and separate text layers.

Every text-free image-generation result is saved, including unused candidates.
PNG import removes fully transparent borders before storage or placement and
retains every pixel with nonzero alpha. It leaves the original output file
intact. `raster_import` / `raster_imports` return original and cropped pixel
dimensions and the crop rectangle. Canvas imports preserve the requested x/y
and fit height to the trimmed aspect ratio at the requested width, adjusting
size only at object limits; manual resizing still
allows stretching afterwards. Fully transparent PNGs are rejected.

Direct agent raster imports are archived automatically. Final `inspect` saves
new or changed compound groups with at least two artwork layers, keeping each
vector, raster and label editable. Save temporary assemblies before ungrouping
or deleting them. Identical content is deduplicated; changed images and groups
create new snapshots. These saves do not alter the canvas or undo history, and
an asset-save failure blocks agent completion until it succeeds. Pending group
saves survive reloads, and retries do not duplicate a committed snapshot.

| Action | Fields and result |
| --- | --- |
| `asset_list` | Takes only `action`; returns asset names, IDs, dimensions, layer counts and `assets_revision`. |
| `asset_read` | `asset_id`, optional `include_assets:true`; returns `component` with relative object coordinates, SVG and text properties. Raster bytes are omitted by default. |
| `asset_render` | `asset_id`; returns a native PNG preview up to 400 pixels. Does not satisfy or invalidate canvas inspection. |
| `asset_save` | `illustration_id`, `expected_revision`, `expected_assets_revision`, unique `request_id`, `name`, and exactly one of component/group `id`, component `ids`, or `raster_asset` plus `textFree:true`. A raster file can be saved without placing it. Saves without altering canvas geometry or revision. |
| `asset_delete` | `asset_id`, `expected_assets_revision`, unique `request_id`. Removes only the saved snapshot. |

Insert through normal revision-guarded `apply`, for example:

```json
{"op":"insert_asset","asset_id":"id-from-asset-list","canvas":"main","x":100,"y":120,"width":300}
```

The position is the top-left of the complete rotated selection bounds. Width
and height scale all members and text fonts proportionally; omit both for native
size, and omit x/y to center the copy. `apply.inserted_assets` returns component
IDs, group ID (null for a single component), and final bounds. Insertions are
atomic with other operations, undoable, and require a new canvas inspection.
Asset save/delete use a separate library revision and retain the last 64 request
receipts for retry safety. Each asset holds up to 200 layers and 12 million
serialized characters. The shared index is limited by its serialized size,
with no fixed asset-count quota. The canonical `reusable-assets.json`
index commits immutable `assets/<id>/component.json` snapshots only after they
have been written successfully. Failed index writes preserve the prior library.

`plugin_canvas` is available through Hikari's MCP server and can be
disabled in Settings. Pass `plugin_id:"scientific-illustration"` and wrap every
action in `request`. A read returns `agent_contract` with this plugin's schema
and drawing instructions. It operates on the same objects as the user interface.

| Action | Result |
| --- | --- |
| `list` | Saved illustration IDs, titles, active selection, and `library_revision`. Takes only `action`. |
| `create` | Create and open an empty figure, optionally with `title`. Requires `expected_library_revision` and unique `request_id`. |
| `open` | Open `illustration_id` from the list. Requires `expected_library_revision` and unique `request_id`. |
| `duplicate` | Copy and open `illustration_id`, optionally with `title`. Requires `expected_library_revision` and unique `request_id`. |
| `read` | Current revision, both canvas dimensions/backgrounds, all object properties and SVG sources. Raster bytes are omitted unless `include_assets:true`. |
| `render` | Native MCP PNG images of `main`, `scratch`, or `both` (default), bounded to 1600 pixels per dimension. This works while the plugin's view is inactive. |
| `inspect` | Record observations after reviewing both rendered canvases. Requires `expected_revision`, the render's `inspection.inspection_id`, and `review` with nonempty `layout`, `labels`, `artwork`, and `science` strings. |
| `inspection_status` | Whether the current revision has a completed review in this agent run. Does not return an inspection receipt. |
| `scratch` | Summon with `visible:true`, close with `visible:false`. Include `illustration_id` to pin the target. View-only; no revision or request ID required. |
| `apply` | An atomic batch of 1–100 operations, acknowledged after durable file persistence. Requires `expected_revision` and unique `request_id`. |

Read/render/apply/scratch/inspect/inspection_status act on the open illustration. Include its `illustration_id`
to pin the target; selection changes return `illustration_changed` without
editing another figure. List and reopen the intended illustration to continue.
Read and render report `scratch_visible`; hiding never deletes artwork or
prevents canvas readback. Scratch visibility is temporary and resets on
selection/reload.

`read` returns `imageGenerationPercent` (`null` for Automatic) and matching
renderer instructions. To change it when requested by the user, apply
`{op:"image_generation",imageGenerationPercent:75}`; use `null` to restore
Automatic. Changes use the same revision, persistence and inspection rules
as all other document edits.

Shift-click on the canvas or in Layers to select multiple components on the
same canvas. Use the **Group** button in the right toolbar (⌘G / Ctrl+G);
use its adjacent **Ungroup** button (⌘⇧G / Ctrl+Shift+G) to release them. Both
buttons work while the Layers rail is closed and enable when the selection allows the action. A group
has one selection frame with eight handles. Drag or use arrow keys to move
it; resizing or changing its width/height scales the entire group
proportionally, including text fonts. Text keeps its fixed ratio. Select a
child in Layers, or Alt-click it on the canvas, to edit it independently.
Group membership survives save/reload, undo/redo and copying between canvases.
Grouping and ungrouping do not change placement or paint order. SVG exports
retain separate object groups and include membership metadata; there is no
extra nested transform that could move the artwork.

Operations are `upsert` (complete object), `update` (id and property patch),
`delete`, `transfer` (canvas, optional copy and new_id), `canvas` (dimension
and background patch), `order` (all canvas IDs, back-to-front), `title`, and
`complexity` (with `complexity:"simple"`, `"standard"` or `"detailed"`),
`group`, `ungroup`, `transform`, and `rotate`.
`{op:"rotate",id:"new-group",degrees:30}` rotates every member clockwise by
30° around the group's bounds center in one edit. Alternatively supply `ids`
for a selection, or a component `id`. An optional `pivot:{x:…,y:…}` chooses a
canvas-space center. Sizes, text formatting, membership, and paint order stay
the same; each member retains independent position and rotation properties.
Read includes `groups`, each with `id`, `name`, `canvas`, component `ids` and
current `bounds`. Group with `{op:"group",id:"new-group",name:"Organelle",
ids:["shape","label"]}`; ungroup with `{op:"ungroup",id:"new-group"}`.
Every member must exist on the same canvas. Include every member when merging
existing groups. Nested groups are merged into a flat membership list.
Use `{op:"transform",id:"new-group",patch:{x:100,y:120,width:300}}` to move
and proportionally resize it from its current bounds. Supply either width or
height, or both at the same scale. Transforms can instead take component
`ids` on one canvas. Unsupported member size/font limits reject the batch.
Group IDs also accept `update` (name and/or x/y/width/height), `delete` (all
members), and `transfer` (all members). Copying groups creates fresh member
IDs, returned in `groups`. Individual component IDs retain all property
editing. Deleting or moving a member to another canvas removes its membership;
groups with fewer than two members dissolve. Group edits invalidate inspection.
Read returns the saved complexity and matching agent instructions. Agents
change this setting only when the user requests another level.
For `upsert` and `update`, supply outer `assets:[{id:"texture",path:"image.png"}]`
and operation `raster_asset:"texture"`. Hikari reads files confined to its storage
root and verifies format/size; this plugin embeds the supplied bytes.
The raster object or patch must include `textFree:true`. Import sets the box height
from its width to match the image's aspect ratio; later resizing may stretch it.

Example after reading the revision:

```json
{
  "plugin_id": "scientific-illustration",
  "request": {
  "action": "apply",
  "illustration_id": "illustration-id-from-read",
  "expected_revision": "revision-from-read",
  "request_id": "unique-request-id",
  "operations": [
    {"op":"upsert","object":{"id":"cell","name":"Cell","type":"vector","canvas":"scratch","x":20,"y":20,"width":180,"height":140,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 180 140\"><ellipse cx=\"90\" cy=\"70\" rx=\"85\" ry=\"65\" fill=\"#dce9e0\" stroke=\"#587a64\" stroke-width=\"3\"/></svg>"}},
    {"op":"upsert","object":{"id":"cell-label","type":"text","text":"Cell","canvas":"main","x":180,"y":300,"width":180,"height":50,"fontFamily":"Arial","fontSize":24,"fontWeight":600,"color":"#27352d","align":"middle","anchor":"middle"}}
  ]
  }
}
```

Read again before the next edit. After composing, render both canvases,
visually review the images and call `inspect`. Revision conflicts require a fresh read and
reconciliation. Retrying identical arguments with the same request ID does not
apply the edit twice, including after undo or reload (last 64 request IDs).

## Persistence and verification

The canonical library index is `Plugins/scientific-illustration/library.json`
under Hikari storage. It points to the committed scene and embedded assets
for each illustration under `illustrations/<id>/scene-a.json` or `scene-b.json`.
Saves alternate between these files, then atomically replace the index using
the existing plugin-confined `files` API. If the index write fails, the prior
scene remains committed and usable after reload. Legacy `workspace.json` is
preserved during migration. Plugin settings contain only the library pointer.
The library holds up to 100 illustrations, each with up to 200 objects and
12 million serialized characters; the host file-size ceiling is also enforced.
Undo/redo keeps the last 25 edits of the active figure and resets on selection.
Storage changes reload the library from the newly selected root.
Inspection receipts and observations are temporary and scoped to one agent
run and revision; they do not survive reloads or travel with exported figures.

Run portable persistence tests with `node --test tests/library.test.mjs` from
this folder. The host integration fixture in the Hikari repository separately
checks installation, appearance/layout APIs, manual controls, MCP readback,
and saved-library behavior in Electron using temporary storage.

The folder contains all runtime modules and agent instructions. It does not
register as a bundled plugin. Removing the folder from Settings disables its
host access; the saved scene stays in Hikari storage. To distribute, zip this
folder, extract it on another computer, and select the extracted folder in the
normal installer. The host needs the public agent plugin APIs introduced with
this plugin; older builds reject those permissions. Enforced inspection needs
the matching Hikari host with the canvas completion gate. External MCP clients
can render and inspect, but their final responses are outside Hikari's gate.
Per-illustration chat requires the matching host with `agent.setContext` support.
