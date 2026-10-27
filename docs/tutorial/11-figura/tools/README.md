# Figura tutorial maintenance

The operating guide is [figura.md](../figura.md), and its generated offline reading view is [index.html](../index.html).

The capture loads the repository's actual Figura markup, styles, editor, Cropper, and shared host toolbar renderer into a disposable Electron profile. A local loopback server supplies source modules and bundled fonts; all other HTTP(S) requests are blocked. The host toolbar uses the real `createPluginWorkspaceTools` controller and CSS. The fixture supplies the frame boundary and stops host-toolbar clicks from bubbling into the inline plugin, matching an iframe's event isolation. It checks that hosted menu buttons are exposed to pointer hit testing. The app's top navigation and agent chat UI are outside the captured workspace.

The example uses fictional schematic cells made from code-native SVG and canvas shapes, with independent editable text. Storage, download, and clipboard adapters are scoped to the preview. Library and asset persistence use the actual source workspace and an in-memory file map. No personal workspace, live AI call, external account, or research figure is used. The prompt and generation preferences are captured without submitting an AI request.

Manual controls exercise text and vector edits, raster import and crop, selection, geometry, keyboard rotation, visibility, grouping, alignment, copy/paste, reusable assets, library duplication, and SVG export. SVG bytes from the real exporter are saved as the example figure. Native storage durability, native file dialogs, AI output, Plotly rendering, and PNG/PowerPoint downloads are not verified by this capture. These limitations belong here rather than in the operating guide.

Screenshots use a 1600 × 1000 CSS-pixel viewport and day appearance, with example data dated 25 October 2026 in America/Chicago. Source version, target rectangles, and interaction checks are recorded in [capture-manifest.json](../capture-manifest.json). This verifies the source renderer rather than an installed package.

From the repository root:

```sh
node docs/tutorial/11-figura/tools/capture.cjs
node docs/tutorial/11-figura/tools/build.cjs
```

Capture requires the project's Electron dependency. Build requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is supplied there. Original captures are in `images/raw/`; annotated PNGs and editable SVG annotations are in `images/`.

Inspect every screenshot after refreshing it. Check that highlighted controls are visible, arrows point to them, and the operating text matches the current interface. Preserve unrelated source and research changes.
