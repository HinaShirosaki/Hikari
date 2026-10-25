# Chemicals tutorial maintenance

The user-facing chapter is [chemicals.md](../chemicals.md). Its generated reading view is [index.html](../index.html).

The capture tool loads the repository's actual Chemicals HTML, styles, and controller, with the shell's real navigation and top-bar search, into a disposable Electron profile. It uses fictional local records, blocks remote requests, and answers desktop calls from memory: the SQLite write is only recorded, and the storage path is only a label. The import step uses the renderer's own CSV reader rather than the desktop parser, and its column names are all recognized locally, so no AI request is made. Capture checks verify the depicted interactions in preview state, and stop the run if the renderer reports an error.

Screenshots use a 1600 × 1000 CSS-pixel viewport, day appearance, and an example date of 24 October 2026 in America/Chicago. The package version, annotation coordinates, and checks are recorded in [capture-manifest.json](../capture-manifest.json). Images show the source renderer rather than verifying an installed release.

From the repository root:

```sh
node docs/tutorial/06-chemicals/tools/capture.cjs
node docs/tutorial/06-chemicals/tools/build.cjs
```

The first command requires the project's Electron dependency. The build command requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is provided there.

Original captures are kept in `images/raw/`. Annotated PNGs and editable SVG callouts are in `images/`. Callout labels are placed in the order whose arrows cross each other and the other highlights least. Inspect the PNGs after refreshing, and check each arrow against the visible control. No changes to the application are needed to build this chapter.
