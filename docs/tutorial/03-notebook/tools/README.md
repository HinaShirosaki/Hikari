# Notebook tutorial maintenance

The user-facing chapter is [notebook.md](../notebook.md). Its generated reading view is [index.html](../index.html).

The capture tool loads the repository's actual Notebook HTML, styles, Tabulator tables, and controller into a disposable Electron profile. It uses fictional local records, blocks remote requests, and answers desktop calls from memory: result files are recorded but never written, and the storage path is only a label. It does not run a live model, open Gel or Assay, export a PDF, or print. Suggested pages are fixed fictional records. Capture checks verify the depicted interactions and save behavior in preview state, and stop the run if the renderer reports an error.

Screenshots use a 1600 × 1000 CSS-pixel viewport, day appearance, and an example date of 24 October 2026 in America/Chicago. The bench toolbox figure shows the real widget at twice its size. The package version, annotation coordinates, and checks are recorded in [capture-manifest.json](../capture-manifest.json). Images show the source renderer rather than verifying an installed release.

From the repository root:

```sh
node docs/tutorial/03-notebook/tools/capture.cjs
node docs/tutorial/03-notebook/tools/build.cjs
```

The first command requires the project's Electron dependency. The build command requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is provided there.

Original captures are kept in `images/raw/`. Annotated PNGs and editable SVG callouts are in `images/`. Inspect the PNGs after refreshing, and check each arrow against the visible control. No changes to the application are needed to build this chapter.
