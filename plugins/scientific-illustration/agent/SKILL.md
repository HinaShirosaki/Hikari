---
name: scientific-illustration
description: Draw editable scientific figures using SVG components, independent labels, and main/scratch canvases in the Scientific Illustration plugin.
---

Call `plugin_canvas` with `plugin_id:"scientific-illustration"` and
`request:{action:"read"}`. Follow the returned `agent_contract.request_schema`.
The plugin owns this contract; its files can be copied without application code.

Read the figure's saved `complexity` and follow the matching
`agent_contract.instructions`, which define that level's targets. Change
complexity only when the user requests it, using the `complexity` operation.
Complexity never requires raster artwork.

Pin the returned `illustration_id` on every read/render/apply/scratch request. The left
rail lists saved illustrations; `list` returns their IDs and library revision.
`create`, `open`, and `duplicate` require `expected_library_revision` and a
unique `request_id`; open/duplicate also require `illustration_id`. On
`illustration_changed`, list and reopen the intended figure before editing.
Preserve the user's selection and edits when reconciling; never silently draw
in a different illustration.

Read before editing. Use main directly for figures without intricate components.
Scratch is hidden by default; summon it when needed for intricate components:
`request:{action:"scratch",illustration_id:"ID-from-read",visible:true}`.
Inspect components with render, then copy/transfer to main and close scratch
with `visible:false` when finished. Hiding preserves contents, and both canvases
remain readable/renderable while hidden. Read reports `scratch_visible`;
visibility resets on selection/reload. This view action needs no revision or
request ID. Prefer SVG. All artwork must be text-free,
including raster assets and glyphs converted to paths. Add every label as an
independent text object. Edit fontFamily, fontSize, fontWeight, color, align,
rotation and anchor through object patches.

Place each component using canvas-unit `x`/`y` at its unrotated box's top-left.
`width`/`height` define its viewport; rotation is clockwise about that box's
center. SVG `preserveAspectRatio` is honored, defaulting to `xMidYMid meet`;
set it to `none` only when stretching is intended. Transfers preserve geometry
in canvas units. Internal SVG IDs and logical object IDs are isolated from
other components and editor controls. SVG `currentColor` defaults to black,
or its explicit `color` attribute, regardless of the UI theme. Inter labels
use the bundled font in both live canvases and embedded SVG/PNG output.

Use SVG first for components it can express clearly. You can use an available
image-generation tool for individual components too complex to construct well
in SVG, including intricate biological structures, organic forms, textures
and realistic detail. Generate those components separately, with transparent
backgrounds when appropriate, and assemble their independent raster objects
with SVG components on the canvas. Keep arrows, connectors and all labels
independently editable; do not flatten the entire figure into one image.
Visually inspect generated output for baked-in text. Import a generated
file saved inside Hikari storage using outer `assets:[{id:"texture",path:"image.png"}]`
and operation `raster_asset:"texture"`, with `textFree:true` on the object/patch.
If generation is unavailable, explain the limitation and use suitable SVG or
user-provided artwork.

Apply requires the latest expected_revision and a unique request_id. Each batch
is atomic and acknowledged after saving. On uncertain acknowledgement, retry
identical arguments with the same ID; on conflict, read and reconcile. Preserve
user edits. Render both canvases and inspect actual output before completion.
