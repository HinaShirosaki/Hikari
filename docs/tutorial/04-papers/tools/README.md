# Papers tutorial maintenance

The user-facing chapter is [papers.md](../papers.md). Its generated reading view is [index.html](../index.html).

The capture tool loads the repository's actual Papers HTML, the shell's PDF tool strip, styles, controller, and pdf.js into a disposable Electron profile. It uses fictional local records, blocks remote requests, and answers desktop calls from memory: uploads and moves are recorded but never written, and the storage path is only a label. The research brief is a fixed illustrative record served in place of a saved analysis. It does not run a live model, open the chat, or print. Capture checks verify the depicted interactions in preview state, and stop the run if the renderer reports an error.

The only PDF is [buffer-choice-example.pdf](../examples/buffer-choice-example.pdf), a fictional teaching paper. The capture tool builds it from [example-paper.html](example-paper.html) with Chromium when the file is missing, then appends PDF metadata (title, authors, journal, year, URL) that Chromium cannot write. Delete the PDF to rebuild it.

Screenshots use a 1600 × 1000 CSS-pixel viewport, day appearance, and an example date of 24 October 2026 in America/Chicago. The package version, annotation coordinates, and checks are recorded in [capture-manifest.json](../capture-manifest.json). Images show the source renderer rather than verifying an installed release.

From the repository root:

```sh
node docs/tutorial/04-papers/tools/capture.cjs
node docs/tutorial/04-papers/tools/build.cjs
```

The first command requires the project's Electron dependency. The build command requires `marked`; set `NODE_PATH` to the bundled runtime's `node_modules` directory if it is provided there.

Original captures are kept in `images/raw/`. Annotated PNGs and editable SVG callouts are in `images/`. Inspect the PNGs after refreshing, and check each arrow against the visible control. No changes to the application are needed to build this chapter.
