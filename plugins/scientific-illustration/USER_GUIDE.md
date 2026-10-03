# Scientific Illustration

Install this folder using **Settings → Skills & plugins**, enable it and reload.
The **Scientific Illustration** workspace then appears under **More**. Configure Hikari storage and sign in to Codex,
enter a figure description, and click **Draw with Codex**. Progress appears in
the workspace's chat rail. Each illustration has its own conversation and
Codex session, separate from other figures, paper and Assay chats. Switching
figures restores their chat histories and unsent chat drafts. New and duplicate
figures start with empty chats. The rail shows no prefilled prompt suggestions.
Messages show only your description. Canvas targeting and drawing rules are
provided separately through Hikari's agent context and the canvas contract.

The **Illustrations** left rail contains saved figures. Use **+** to create
one, the title field to rename it, and **Figure options → Duplicate illustration** to copy
the entire figure. Search filters titles; selecting a row opens its main and
scratch contents. Each illustration saves independently. Your existing figure
is added to this library automatically. The canvas uses the full editing width
when a figure opens. **Layers** in the top toolbar opens layers and properties
beside it; the panel's **Close** button returns that space to the canvas. At
narrow widths this panel overlays the canvas and scrolls independently. The UI follows Hikari's day/night appearance and font scale, and
shares its left rail width. Drag the rail divider to resize. Use the chevron
beside the figure title to
hide or show **Illustrations** and give the canvas more room. Hikari saves the
folded state per plugin through `app.setLeftRailFolded` (the `layout` permission).
On older Hikari builds the toggle stays hidden until this API is available.
An existing installation without `layout` permission needs the folder re-added
to grant it.

The main canvas defaults to 1200 × 800; scratch defaults to 500 × 350. Both
are editable SVG scenes with independent vector, raster, and text objects.
Scratch is hidden by default. The agent summons it only when useful for complex
components; you can also use **Scratch** in the control strip below the canvas.
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
The opposite corner or edge midpoint stays fixed, including rotated
objects. Arrow keys nudge, Shift nudges by ten pixels; Escape clears selection.
Use **− / +** to zoom and **Fit** to show the whole canvas. Scroll to pan when
zoomed, or hold **⌘ / Ctrl** while scrolling to zoom at the pointer. Zoom applies
to the active canvas; main and scratch keep separate views. Saved geometry,
exports and agent readbacks keep their original canvas coordinates. Handles
retain their screen size at every zoom. Layer rows show component previews and a visibility button
on hover or keyboard focus. Main and scratch layers are grouped separately.
Use **+** in the top toolbar for text labels, vector components, or imported artwork.

The inspector shows the selected component's relevant controls first. Select a
canvas object and open **Layers**, or select its layer row. Selecting or dragging
on the canvas keeps the current panel layout steady. Double-click a label to
open its independent text controls, then use the compact font,
size, color, bold/italic/underline, alignment, weight and anchor controls.
Rotation and opacity stay visible; expand **Position & size** for exact
coordinates, dimensions and canvas membership. Vector source and fill/stroke
overrides are editable; clearing an override restores the original SVG style.
Raster artwork can be replaced. Layer actions duplicate, reorder, delete, or
copy the selection to the other canvas. No label is part of an artwork asset.

When chat is closed, describe a figure or change in the compact composer beneath
the canvas. Click the arrow or press **⌘Enter / Ctrl+Enter** to send it to Codex.
Opening the agent rail hides the canvas composer and expands the canvas; use
the rail's input for subsequent changes. Folding chat restores the compact
composer and any unsent canvas draft. Complexity remains in the top toolbar
throughout. The canvas remains
visible while scrolling a long property panel. Undo and redo buttons enable
only when history is available. The slim strip below the canvas holds size,
zoom, Fit and Scratch. The canvas-size dropdown offers Landscape,
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

Shift-click on the canvas or in Layers to select multiple components on the
same canvas. Use **Group** in Layers or **Figure options → Group selection**
(⌘G / Ctrl+G); use **Ungroup** (⌘⇧G / Ctrl+Shift+G) to release them. A group
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
`group`, `ungroup`, and `transform`.
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
