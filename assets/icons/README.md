# Module icons

The module navigation icons use the same Lucide 1.17.0 glyphs as the approved
dock demo. They are bundled SVGs with no runtime icon-library dependency.

Source: https://unpkg.com/lucide-static@1.17.0/icons/
License: [LUCIDE-LICENSE.txt](LUCIDE-LICENSE.txt).

| Module asset | Lucide glyph |
| --- | --- |
| home.svg | house |
| protocols.svg | clipboard-list |
| biology-notebook.svg | notebook-pen |
| papers.svg | files |
| sample-inventory.svg | test-tubes |
| chemicals.svg | flask-conical |
| workflows.svg | workflow |
| agent.svg | sparkles |
| sequence-viewer.svg | dna |
| assay.svg | grid-3x3 |
| tools.svg | wrench |
| settings.svg | settings |

The More button in `ui/html/shell/start.html` uses Lucide's `layout-grid` glyph.
SVG paths are unchanged; root attributes are normalized to the app's
`currentColor`, 24-unit view box, 1.5-unit stroke weight, and shared icon sizing.

The folder and update glyphs (`folder.svg`, `update.svg`) and the remaining PNG/SVG marks
(`hikari*.svg`, `dolphin-dna-icon*.png`) are Hikari's own artwork.
