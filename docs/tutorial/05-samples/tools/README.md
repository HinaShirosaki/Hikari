# Samples tutorial maintenance

The user-facing chapter is [samples.md](../samples.md). Its generated reading view is [index.html](../index.html).

The capture tool loads the repository's actual Samples HTML, styles, and controller, with the shell's real navigation and top-bar search, into a disposable Electron profile. It uses fictional local records, blocks remote requests, and answers desktop calls from memory: saves stay in memory, the storage path is only a label, and plasmid name suggestions come from a fixed list in place of the DNA library. The exported CSV is saved to the run's temporary folder and checked there. Capture checks verify the depicted interactions in preview state, and stop the run if the renderer reports an error.

Screenshots use a 1600 × 1000 CSS-pixel viewport, day appearance, and an example date of 24 October 2026 in America/Chicago. The package version, annotation coordinates, and checks are recorded in [capture-manifest.json](../capture-manifest.json). Images show the source renderer rather than verifying an installed release.

From the repository root:

```sh
node docs/tutorial/05-samples/tools/capture.cjs
node docs/tutorial/05-samples/tools/build.cjs
```

The first command requires the project's Electron dependency. The build command requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is provided there.

Original captures are kept in `images/raw/`. Annotated PNGs and editable SVG callouts are in `images/`. Callout labels are placed in the order whose arrows cross each other and the other highlights least. Inspect the PNGs after refreshing, and check each arrow against the visible control. No changes to the application are needed to build this chapter.
