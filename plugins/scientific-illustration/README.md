# Scientific Illustration

An installable Hikari plugin for editable scientific figures. This folder is the
complete plugin: no npm install, build step, or application-source imports.
Copy it anywhere while keeping the folder name `scientific-illustration`.

1. Use a Hikari build with the public `agent:chat` and `agent:canvas` plugin APIs.
2. In **Settings → Skills & plugins**, add this plugin folder and enable it.
3. Reload Hikari, configure storage, and open **More → Scientific Illustration**.
4. Sign in to Codex, describe your figure, and choose **Draw with Codex**.

The main canvas assembles the final figure. The smaller scratch canvas opens
only when you or the agent summon it for component work, and closes without
losing its contents. Vector, raster, and text layers remain independently editable by
you and Codex. SVG artwork is text-free; labels are separate text objects.
The left rail lists saved illustrations with search, creation, duplication,
and selection. Existing single-figure workspaces migrate automatically.
The main canvas has a compact prompt below it. Layers have component previews
and visibility controls; selecting a layer reveals its editing controls.
The canvas-size dropdown provides common formats and custom dimensions for
the active canvas, preserving the placed components' positions and sizes.
Text formatting comes first, with precise geometry available on expansion.
SVG components retain their authored aspect ratio, and component IDs are
isolated from editor controls and other artwork. Canvas readback and export
use the same artwork colors and embed the bundled Inter font for labels.
Choose Simple, Standard or Detailed complexity in the composer. The setting
is saved with each figure and supplies matching instructions for the agent
to form its illustration brief. Standard is the default for existing figures.

The interface follows Hikari's palette and Inter typography. It uses the
existing `app.info`/`app.context` APIs for appearance and shared rail width,
and `app.setLeftRailWidth` to persist resizing. All fonts and styles ship
inside this folder, so it remains portable.

Read [USER_GUIDE.md](USER_GUIDE.md) for controls, persistence, exports and agent
examples. [agent/SKILL.md](agent/SKILL.md) documents the drawing workflow;
[agent/canvas-contract.mjs](agent/canvas-contract.mjs) owns its request schema.
The plugin returns these instructions and its schema on every agent read.

Permissions: `storage` and `files` save its own illustration library; `downloads` exports using
a native save dialog; `agent:chat` submits your prompt to its chat rail;
`agent:canvas` lets the agent read, edit and render this workspace; `layout`
saves shared rail resizing. Re-add an older installation in Settings to grant
the new layout permission; its saved figures stay in Hikari storage.

Drawing prompts explicitly encourage the agent to use image generation for
individual components too complex to construct clearly in SVG, then assemble
those independent text-free raster layers with SVG and separate labels.
Raster generation uses the agent's image-generation tool when available. The
plugin itself has no network dependency or image-generation credentials.
