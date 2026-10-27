# Plate tutorial maintenance

The operating guide is [plate.md](../plate.md), and its generated offline reading view is [index.html](../index.html).

The capture loads the repository's actual Plate HTML, styles, controllers, Tabulator grid, and Plotly chart renderer into a disposable Electron profile. It uses fictional 24-well records and in-memory desktop storage adapters. Setup saves, concentration fills, serial dilution calculations, result edits and CSV import, formulas, groups, analysis, chart formatting, focus mode, and deletion run through the renderer. It never opens a personal research workspace or makes network requests.

CSV result parsing is supplied by a local fixture adapter; the renderer's matrix detection and selection flow is real. Native Excel parsing, durable native file storage, and PNG/SVG download dialogs are not exercised. The chart export buttons are documented and captured without writing an exported chart.

Screenshots use a 1600 × 1000 CSS-pixel viewport and day appearance, with example data dated 25 October 2026 in America/Chicago. The source package version, screenshot targets, and interaction checks are recorded in [capture-manifest.json](../capture-manifest.json). This verifies the source renderer rather than an installed package.

From the repository root:

```sh
node docs/tutorial/09-plate/tools/capture.cjs
node docs/tutorial/09-plate/tools/build.cjs
```

Capture requires the project's Electron dependency. Build requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is supplied there. Original captures are in `images/raw/`; annotated PNGs and editable SVG annotations are in `images/`.

Inspect every screenshot after refreshing it. Check that all highlighted controls are visible, arrows end at the intended controls, and the operating text matches the current interface. Keep implementation and verification details in these notes rather than the operating guide.
