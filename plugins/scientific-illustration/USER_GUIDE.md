# Scientific Illustration

Install this folder using **Settings → Skills & plugins**, enable it and reload.
The **Scientific Illustration** workspace then appears under **More**. Configure Hikari storage and sign in to Codex,
enter a figure description, and click **Draw with Codex**. Progress appears in
the workspace's independent chat rail; its conversation is saved separately
from paper and Assay chats.

The **Illustrations** left rail contains saved figures. Use **+** to create
one, the title field to rename it, and **Figure options → Duplicate illustration** to copy
the entire figure. Search filters titles; selecting a row opens its main and
scratch contents. Each illustration saves independently. Your existing figure
is added to this library automatically. Layers and properties stay beside the
canvases. The UI follows Hikari's day/night appearance and font scale, and
shares its left rail width. Drag the rail divider to resize; upgrading an
existing installation requires re-adding the folder to grant `layout`.

The main canvas defaults to 1200 × 800; scratch defaults to 500 × 350. Both
are editable SVG scenes with independent vector, raster, and text objects.
Scratch is hidden by default. The agent summons it only when useful for complex
components; you can also use **Scratch canvas** beside the main canvas heading.
Use **Close** to hide it. Closing preserves its objects, and the agent can read,
edit, and render both canvases while it is hidden. Opening another illustration
or reloading starts with scratch hidden again. Selecting a scratch layer or
copying a component to scratch opens it for manual work.
Select objects on a canvas or in the layer list; drag to move and use the
bottom-right handle to resize. Arrow keys nudge, Shift nudges by ten pixels;
Escape clears the selection. The handle retains its screen size as the figure
fits the workspace. Layer rows show component previews and a visibility button
on hover or keyboard focus. Main and scratch layers are grouped separately.
Use **Layers +** for text labels, vector components, or imported artwork.

The inspector shows the selected component's relevant controls first. Select
or double-click text to edit its independent label, then use the compact font,
size, color, bold/italic/underline, alignment, weight and anchor controls.
Rotation and opacity stay visible; expand **Position & size** for exact
coordinates, dimensions and canvas membership. Vector source and fill/stroke
overrides are editable; clearing an override restores the original SVG style.
Raster artwork can be replaced. Layer actions duplicate, reorder, delete, or
copy the selection to the other canvas. No label is part of an artwork asset.

Describe a figure or change in the composer beneath the canvas. Click the
arrow or press **⌘Enter / Ctrl+Enter** to send it to Codex. The canvas remains
visible while scrolling a long property panel. Undo and redo buttons enable
only when history is available. The canvas-size dropdown offers Landscape,
Portrait, Square, Widescreen and Small presets. Select **Custom…** for exact
width and height; the adjacent options button also opens size/background
settings. These controls apply to the active canvas: select its heading or a
layer first. Resizing changes the canvas bounds while preserving object
coordinates and sizes; it does not scale the artwork. Undo restores the prior
canvas size. Agent edits and saved custom sizes appear in the dropdown too.

The composer offers three **Complexity** levels, saved per illustration:

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

SVG aspect ratio is preserved by default (`xMidYMid meet`), and any explicit
`preserveAspectRatio` is honored. Use `none` in the SVG source only for deliberate
stretching. The object's width and height describe its viewport; artwork may
leave space inside it. Coordinates use canvas units at the unrotated box's
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

Codex uses SVG first and can use an available image-generation model for
individual components too complex to construct clearly in SVG, including
intricate biological structures, textures and realistic detail. It generates
these as separate text-free raster layers, using transparent backgrounds when
appropriate, and assembles them with editable SVG components and independent
labels. This guidance is included in both the submitted drawing prompt and
the canvas contract Codex reads. This plugin does
not add a new image-generation provider or require another API key. If the
agent runtime has no image-generation tool, it must explain that limitation
and use suitable SVG or user-provided raster artwork. Every raster import
requires confirmation that it contains no baked-in text; this is a visual
inspection requirement, not an OCR guarantee. PNG, JPEG, WebP, up to 5 MiB
per asset and 64 megapixels decoded.

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
| `scratch` | Summon with `visible:true`, close with `visible:false`. Include `illustration_id` to pin the target. View-only; no revision or request ID required. |
| `apply` | An atomic batch of 1–100 operations, acknowledged after durable file persistence. Requires `expected_revision` and unique `request_id`. |

Read/render/apply/scratch act on the open illustration. Include its `illustration_id`
to pin the target; selection changes return `illustration_changed` without
editing another figure. List and reopen the intended illustration to continue.
Read and render report `scratch_visible`; hiding never deletes artwork or
prevents canvas readback. Scratch visibility is temporary and resets on
selection/reload.

Operations are `upsert` (complete object), `update` (id and property patch),
`delete`, `transfer` (canvas, optional copy and new_id), `canvas` (dimension
and background patch), `order` (all canvas IDs, back-to-front), `title`, and
`complexity` (with `complexity:"simple"`, `"standard"` or `"detailed"`).
Read returns the saved complexity and matching agent instructions. Agents
change this setting only when the user requests another level.
For `upsert` and `update`, supply outer `assets:[{id:"texture",path:"image.png"}]`
and operation `raster_asset:"texture"`. Hikari reads files confined to its storage
root and verifies format/size; this plugin embeds the supplied bytes.
The raster object or patch must include `textFree:true`.

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

Read again before the next edit. After composing, render both canvases and
inspect actual output. Revision conflicts require a fresh read and
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

Run portable persistence tests with `node --test tests/library.test.mjs` from
this folder. The host integration fixture in the Hikari repository separately
checks installation, appearance/layout APIs, manual controls, MCP readback,
and saved-library behavior in Electron using temporary storage.

The folder contains all runtime modules and agent instructions. It does not
register as a bundled plugin. Removing the folder from Settings disables its
host access; the saved scene stays in Hikari storage. To distribute, zip this
folder, extract it on another computer, and select the extracted folder in the
normal installer. The host needs the public agent plugin APIs introduced with
this plugin; older builds reject those permissions.
