# Scientific Illustration

An installable Hikari plugin for editable scientific figures. This folder is the
complete plugin: no npm install, build step, or application-source imports.
Copy it anywhere while keeping the folder name `scientific-illustration`.

The dock icon combines a cell diagram with a drawing pen. `icon.svg` is a
text-free vector asset with the same 24-unit view box and 1.5-unit stroke as
Hikari's other module icons. A host with plugin-icon support loads it from
the manifest on app reload and adapts its color to the current theme.

1. Use a Hikari build with the public `agent:chat` and `agent:canvas` plugin APIs.
2. In **Settings → Skills & plugins**, add this plugin folder and enable it.
3. Reload Hikari, configure storage, and open **More → Scientific Illustration**.
4. Sign in to Codex, describe your figure, and choose **Draw with Codex**.

The main canvas assembles the final figure. The smaller scratch canvas opens
only when you or the agent summon it for component work, and closes without
losing its contents. Vector, raster, and text layers remain independently editable by
you and Codex. SVG artwork is text-free; labels are separate text objects.
Shift-click components to select several, then use the toolbar's Group button
(⌘G / Ctrl+G). The adjacent Ungroup button uses ⌘⇧G / Ctrl+Shift+G. Groups move and resize
proportionally together; child layers remain editable in Layers. Alt-click
on the canvas selects an individual group member. Groups persist with each
illustration and are available through the agent's canvas API.
The selection-tool dropdown below the canvas offers **Select & move (V)** and
**Freehand (L)**. Select & move combines rectangle selection and movement:
drag empty space to select touched components, then drag a selected component
to move the whole selection. Freehand draws a lasso and also lets you drag
selected components to move them. Resize handles work in both tools. Shift
adds to the selection; Alt selects group members individually. M also opens
Select & move. Escape cancels a selection gesture.
Selection respects rotated bounds and zoom, without changing saved artwork.
Each selected component has its own outline inside one shared move/resize frame.
Select a component, several layers or a group and choose **Save as asset…**
in Layers. **Assets** in the toolbar provides search and previews; click an asset
to insert an independent editable copy on the active canvas. Saved components
are shared across all illustrations in this plugin's current Hikari storage.
Vectors, embedded raster images and separate text labels retain their relative
placement and styling. Multi-layer copies become a movable group; editing or
deleting a copy never changes the saved original. Codex uses the same library
through `asset_list`, `asset_read`, `asset_render`, `asset_save`, `asset_delete`
and the `insert_asset` apply operation. No extra host API or permission is needed.
The left rail lists saved illustrations with search, creation, duplication,
and selection. The chevron beside the figure title hides or shows the rail;
Hikari saves that preference through the `layout` API. Existing single-figure
workspaces migrate automatically.
The main canvas has a compact prompt below it while the agent rail is closed.
Opening chat hides that prompt and gives its space back to the canvas, so only
one composer is visible. Complexity stays in the toolbar in both states.
The canvas uses the full editing width by default. The **Layers / Assets** switch
in the toolbar opens either panel in the shared editing rail. Only one panel
can be open at a time. Clicking its active button again folds the rail and
gives that space back to the canvas. The switch stays visible at narrow widths.
Layers provides component previews, visibility and property controls.
Adding a layer or double-clicking a text
label opens its controls. Canvas size, zoom and scratch sit in a slim strip
below the canvas. At narrow widths the panel overlays the canvas and scrolls
independently.
Zoom controls and Fit adjust the editing view independently for each canvas.
Eight resize handles work along corners and edges, including rotated layers.
Manual resize stretches SVG artwork with the box; width and height are independent.
Text resizing keeps a fixed aspect ratio and scales the font with the label box.
View zoom leaves saved geometry, exports and agent previews unchanged.

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
