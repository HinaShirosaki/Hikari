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
Shift-click components to select several, then use Group in Layers or Figure
options (⌘G / Ctrl+G). Ungroup uses ⌘⇧G / Ctrl+Shift+G. Groups move and resize
proportionally together; child layers remain editable in Layers. Alt-click
on the canvas selects an individual group member. Groups persist with each
illustration and are available through the agent's canvas API.
The left rail lists saved illustrations with search, creation, duplication,
and selection. The chevron beside the figure title hides or shows the rail;
Hikari saves that preference through the `layout` API. Existing single-figure
workspaces migrate automatically.
The main canvas has a compact prompt below it while the agent rail is closed.
Opening chat hides that prompt and gives its space back to the canvas, so only
one composer is visible. Complexity stays in the toolbar in both states.
The canvas uses the full editing width by default. **Layers** opens a compact
panel with component previews, visibility and property controls; closing it
gives that space back to the canvas. Adding a layer or double-clicking a text
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
