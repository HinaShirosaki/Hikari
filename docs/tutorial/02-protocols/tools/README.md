# Protocol tutorial maintenance

The user-facing chapter is [protocols.md](../protocols.md). Its generated reading view is [index.html](../index.html).

The capture tool loads the repository's actual Protocols HTML, styles, and controller into a disposable Electron profile. It uses fictional local records, blocks remote requests, and supplies fixed illustrative responses for generation and polish. It does not open a research workspace, run a live model, export a PDF, or print. Capture checks verify the depicted editor interactions and save behavior in preview state.

Screenshots use a 1600 × 1000 CSS-pixel viewport, day appearance, and an example date of 24 October 2026 in America/Chicago. The package version and annotation coordinates are recorded in [capture-manifest.json](../capture-manifest.json). Images show the source renderer rather than verifying an installed release.

From the repository root:

```sh
node docs/tutorial/02-protocols/tools/capture.cjs
node docs/tutorial/02-protocols/tools/build.cjs
```

The first command requires the project's Electron dependency. The build command requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is provided there.

Original captures are kept in `images/raw/`. Annotated PNGs and editable SVG callouts are in `images/`. Inspect the PNGs after refreshing, and check each arrow against the visible control. No changes to the application are needed to build this chapter.
