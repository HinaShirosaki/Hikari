# Gel tutorial maintenance

The operating guide is [gel.md](../gel.md), and its generated offline reading view is [index.html](../index.html).

The capture loads the repository's actual Gel plugin markup, styles, controllers, Cropper, Tabulator, and image-processing pipeline into a disposable Electron profile. The images are deterministic canvas-generated simulations with a ladder-like lane and five sample-like lanes. They are interface fixtures, not experimental measurements or a validated calibration standard. The PNG examples are generated from the same fixture as the screenshots.

Desktop storage and exports use adapters scoped to the preview. Record saves and workspace persistence write to an in-memory map; clipboard writes are retained in the fixture. The real workspace store, image processing, lane detection, ladder entry, band measurements, peak integration, lane table, stack moves, trim controls, project serialization, and inline rename run through the source controllers. No personal workspace or research file is opened, and HTTP(S) requests are blocked.

The supplied project is the real serializer's output for the simulated gels; the capture reopens it through the project file input and checks that its layers and stack are not duplicated. Native storage durability, TIFF decoding, native file dialogs, and PNG/PPTX export downloads are not verified by this capture. The export menu is captured without saving those figures. Source changes elsewhere in the repository are not part of the tutorial work.

Screenshots use a 1600 × 1000 CSS-pixel viewport and day appearance, with example data dated 25 October 2026 in America/Chicago. The source package version, screenshot targets, and interaction checks are recorded in [capture-manifest.json](../capture-manifest.json). Screenshots show the Gel workspace within its frame; the host's top navigation is outside that frame. This verifies the source renderer rather than an installed package.

From the repository root:

```sh
node docs/tutorial/10-gel/tools/capture.cjs
node docs/tutorial/10-gel/tools/build.cjs
```

Capture requires the project's Electron dependency. Build requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is supplied there. Original captures are in `images/raw/`; annotated PNGs and editable SVG annotations are in `images/`.

Inspect every screenshot after refreshing it. Check that the highlighted controls are visible, arrows end at their targets, and the operating text matches the current interface. Keep implementation and verification details in these notes rather than the operating guide.
