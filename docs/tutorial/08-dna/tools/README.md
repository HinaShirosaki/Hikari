# DNA tutorial maintenance

The operating guide is [dna.md](../dna.md), and its generated offline reading view is [index.html](../index.html).

The capture loads the repository's actual DNA HTML, styles, and controllers into a disposable Electron profile. Sequence library requests use an in-memory adapter with fictional circular and linear sequences. Primer saves, base edits, alignments, and builders run through the renderer controllers. The example vector is not a validated biological construct. No personal workspace, live database search, external order, or research file is used.

Screenshots use a 1600 × 1000 CSS-pixel viewport and day appearance, with example data dated 25 October 2026 in America/Chicago. The source package version, screenshot targets, and interaction checks are recorded in [capture-manifest.json](../capture-manifest.json). This verifies the source renderer rather than an installed package or native storage durability.

From the repository root:

```sh
node docs/tutorial/08-dna/tools/capture.cjs
node docs/tutorial/08-dna/tools/build.cjs
```

Capture requires the project's Electron dependency. Build requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is supplied there. Original captures are in `images/raw/`; annotated PNGs and editable SVG annotations are in `images/`.

Inspect every screenshot after refreshing it. Check that the highlighted controls are visible, the arrows point to them, and the operating text matches the current interface. Keep implementation details in these notes rather than the operating guide.
