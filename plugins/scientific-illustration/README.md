# Figura

An installable Hikari plugin for editable scientific figures. This folder is the
complete plugin: no npm install, build step, or application-source imports.
Copy it anywhere while keeping the folder name `scientific-illustration`.

The dock icon combines a cell diagram with a drawing pen. `icon.svg` is a
text-free vector asset with the same 24-unit view box and 1.5-unit stroke as
Hikari's other module icons. A host with plugin-icon support loads it from
the manifest on app reload and adapts its color to the current theme.

1. Use a Hikari build with the public `agent:chat` and `agent:canvas` plugin APIs.
2. In **Settings → Plugins**, add this plugin folder and enable it.
3. Reload Hikari, configure storage, and open **More → Figura**.
4. Sign in to Codex, describe your figure, and choose **Draw with Codex**.

On a host with the context-action API, **Protocol → … → Generate illustration**
opens a new figure for that saved protocol. In **Papers**, select PDF text and
choose **Generate illustration** in its hover toolbar. The plugin creates the
figure, saves its originating protocol or passage and paper Markdown context,
and submits its own brief to that figure's Codex chat. Existing figures stay
intact. Source context remains available on canvas read and after reopening.
Missing or truncated paper context is explicit. No broad protocol/paper read
permission is needed: Hikari grants only the source selected by the user click.

The main canvas assembles the final figure. The smaller scratch canvas opens
only when you or the agent summon it for component work, and closes without
losing its contents. Vector, raster, and text layers remain independently editable by
you and Codex. SVG artwork is text-free; labels are separate text objects.
Shift-click components to select several, then use the toolbar's Group button
(⌘G / Ctrl+G). The adjacent Ungroup button uses ⌘⇧G / Ctrl+Shift+G. Groups move and resize
proportionally together; child layers remain editable in Layers. Alt-click
on the canvas selects an individual group member. Groups persist with each
illustration and are available through the agent's canvas API.
The compact right toolbar offers **Select & move (V)** and **Freehand (L)**,
adding layers, cropping, grouping, Layers, Assets, Scratch, and zoom controls.
It shares Hikari's outer strip with the folded agent chat rail. Opening Layers
or Assets folds chat; opening chat folds the component panel. Hosts without a
shared toolbar use the plugin's local right toolbar. Older hosts with the shared
strip use a compatible glyph for Crop so all controls stay beside chat.
Undo and redo use Hikari's system buttons through the existing plugin API:
`app.setHistory` reports availability, and `app.undo` / `app.redo` restore Figura's
own saved scene history. ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z and Ctrl+Y work inside the canvas;
text fields keep native text undo. Figura has no duplicate undo/redo icons.
Select & move combines rectangle selection and movement:
drag empty space to select touched components, then drag a selected component
to move the whole selection. Freehand draws a lasso and also lets you drag
selected components to move them. Resize handles work in both tools. Shift
adds to the selection; Alt selects group members individually. Escape cancels a selection gesture.
Selection respects rotated bounds and zoom, without changing saved artwork.
Each selected component has its own outline inside one shared move/resize frame.
Select a component, several layers or a group and choose **Save as asset…**
in Layers. **Assets** in the toolbar provides search and previews; click an asset
to insert an independent editable copy on the active canvas. Saved components
are shared across all illustrations in this plugin's current Hikari storage.
**Assets → Import asset…** saves SVG, PNG, JPEG, or WebP files directly to that
library. Select a placed image
and use the toolbar's **Crop selected image** button to crop directly in the
canvas with the bundled Cropper.js 1.6.2 (MIT); no crop dialog, network or npm
install is needed. Crop boxes can be dragged or entered in pixels. Apply keeps
its position and rotation and supports
undo/redo. Transparent pixels remain transparent. Raster imports require
text-free review, and labels stay independent. The original reusable asset
stays intact; save the cropped selection as a new asset if needed.
Vectors, embedded raster images and separate text labels retain their relative
placement and styling. Multi-layer copies become a movable group; editing or
deleting a copy never changes the saved original. Codex uses the same library
through `asset_list`, `asset_read`, `asset_render`, `asset_save`, `asset_delete`
and the `insert_asset` apply operation. No extra host API or permission is needed.
Before every drawing or edit, Codex must check `asset_list` and inspect plausible
matches before creating new artwork. Each image-generation result is saved with
a descriptive name, including unused candidates. Agent PNG imports trim fully
transparent outer pixels while retaining faint visible edges; original Codex
files stay intact. Direct raster imports are archived automatically. Final
inspection archives compound groups with at least two artwork layers and their
independent labels. Identical content is deduplicated, and changed versions keep
the original snapshots. An asset-write failure blocks completion.
The left rail lists saved illustrations with search, creation, duplication,
and selection. The chevron beside the figure title hides or shows the rail;
Hikari saves that preference through the `layout` API. Existing single-figure
workspaces migrate automatically.
An empty illustration has a compact starting prompt below the canvas while the
agent rail is closed. Once either canvas has a component, edits use the agent
chat rail and the bottom prompt stays hidden, even when chat is folded.
Opening chat also hides the starting prompt. Complexity stays in the toolbar.
The canvas uses the full editing width by default. The **Layers / Assets** buttons
in the right toolbar open either panel in the shared editing rail. Only one panel
can be open at a time. Clicking its active button again folds the rail and
gives that space back to the canvas. The buttons stay visible at narrow widths.
Layers provides component previews, visibility and property controls.
Adding a layer or double-clicking a text
label opens its controls. Canvas selection and size share the top toolbar with
the compact title field; zoom, Fit and
Scratch are in the right toolbar. At narrow widths the panel overlays the canvas and scrolls
independently.
Zoom controls and Fit adjust the editing view independently for each canvas.
Eight resize handles work along corners and edges, including rotated layers.
The attached circular rotation handle turns artwork, labels, or selected groups
directly on either canvas. Shift snaps to 15°; Escape cancels the gesture. Keyboard
focus supports 1° arrow-key steps and 15° steps with Shift. Rotations save as one
undoable edit with independently editable member geometry.
Ctrl+C / Ctrl+V (⌘C / ⌘V on macOS) copy and paste selected components or groups
into the active canvas, including another illustration. Copies retain their
artwork, labels, formatting, rotations and group membership, get fresh IDs,
and paste with a small cascading offset. Each paste is one undoable edit.
Manual resize stretches SVG artwork with the box; width and height are independent.
Text resizing keeps a fixed aspect ratio and scales the font with the label box.
Text selection and hit targets follow the rendered label, including multiline
and rotated text, while the saved layout box retains its alignment and anchor.
View zoom leaves saved geometry, exports and agent previews unchanged.

**Export → PowerPoint** writes a `.pptx` with one slide sized to the main canvas.
Visible artwork components remain individual SVG or raster objects; labels are
native editable text boxes. Placement, rotation, opacity, and layer order are
preserved. Group members stay independent in the slide. WebP is converted to
PNG, and SVG includes a PNG fallback for older readers. PowerPoint uses installed
fonts; its Convert to Shape feature can expose an SVG component's internal paths.
PptxGenJS is bundled locally, so this export also works offline.

The canvas-size dropdown provides common formats and custom dimensions for
the active canvas, preserving the placed components' positions and sizes.
Text formatting comes first, with precise geometry available on expansion.
Each illustration has its own chat and Codex session. Switching illustrations
restores that figure's conversation and chat draft; new and duplicate figures
start with empty chats. The chat rail has no prefilled prompt suggestions.
Your prompt is sent and displayed as entered; the scoped agent context supplies
the canvas target and directs Codex to read the plugin's drawing contract.
SVG placement honors the authored aspect ratio, and component IDs are
isolated from editor controls and other artwork. Canvas readback and export
use the same artwork colors and embed the bundled Inter font for labels.
Choose Simple, Standard or Detailed complexity in the toolbar. The setting
is saved with each figure and supplies matching instructions for the agent
to form its illustration brief. Standard is the default for existing figures.

**Figure options (⋯) → Image generation** enables a target of 0%, 25%, 50%, 75%
or 100% for the approximate visual share of eligible illustrative artwork made with Codex
image generation. Off means Automatic (SVG first); 0% requests no new image
generation. The target saves per illustration and applies to new or requested
changes. Boxes, arrows, connectors, panel frames, charts, exact scientific
geometry and separate text labels are excluded; they remain SVG or text even
at 100%. A target never adds unnecessary detail or rasterizes schematic symbols.
These presets supply explicit agent guidance: SVG only, mostly SVG, balanced,
mostly image generation, and image generation for all eligible artwork.
There is no per-request asset-count or aggregate-import-byte quota, and no
plugin quota on image-generation calls. Individual images still require valid
PNG/JPEG/WebP bytes up to 5 MiB, and saved scene/file size limits still apply.

The interface follows Hikari's palette and Inter typography. It uses the
existing `app.info`/`app.context` APIs for appearance and shared rail width,
and `app.setLeftRailWidth` to persist resizing. All fonts and styles ship
inside this folder, so it remains portable.

Read [USER_GUIDE.md](USER_GUIDE.md) for controls, persistence, exports and agent
examples. [agent/workflow.mjs](agent/workflow.mjs) owns the drawing instructions;
[agent/canvas-contract.mjs](agent/canvas-contract.mjs) owns its request schema.
The plugin returns these instructions and its schema on every agent read.

Permissions: `storage` and `files` save its own illustration library; `downloads` exports using
a native save dialog; `agent:chat` submits your prompt to its chat rail;
`agent:canvas` lets the agent read, edit and render this workspace; `layout`
saves shared rail resizing. Re-add an older installation in Settings to grant
the new layout permission; its saved figures stay in Hikari storage.

The agent plans SVG or image generation per component. Schematic geometry and
exact relationships use SVG; required realistic, organic or texture detail
uses image generation when SVG cannot express it clearly. If uncertain, the
agent renders one simple SVG draft before choosing. Complexity controls detail,
not renderer selection. Hybrid figures keep raster components, SVG arrows and
text labels independent. See the decision table in USER_GUIDE.md.
Raster generation uses Codex's built-in `image_gen` tool. The matching Hikari
host enables native image generation for canvas chat turns and imports its
output directly from the managed Codex `generated_images` folder. Imported bytes
are saved in the illustration. The plugin has no separate provider or API key.
If the running Codex lacks that tool or generation fails, the agent reports
the limitation and uses SVG or supplied artwork without switching providers.

Before a drawing run can complete, Codex must render both canvases at the
latest revision and submit observations about layout, labels, artwork and
scientific relationships through `inspect`. Edits invalidate the inspection.
The matching Hikari host enforces this step, with one automatic follow-up if
it is skipped; saved artwork is retained if inspection remains incomplete.
