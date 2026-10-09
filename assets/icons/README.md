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

The folder, update, and cloud glyphs (`folder.svg`, `update.svg`, `cloud-drive.svg`) and the remaining PNG/SVG marks
(`hikari*.svg`, `dolphin-dna-icon*.png`) are Hikari's own artwork.

The Cloud drives provider marks are bundled locally and keep their original colors:

| Asset | Source |
| --- | --- |
| google-drive.png | [Google Drive product logo](https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-64dp/logo_drive_2026_color_2x_web_64dp.png), linked by [Google's branding guide](https://developers.google.com/workspace/drive/api/guides/branding) |
| dropbox.svg | Unchanged glyph paths from [Dropbox's brand logo page](https://brand.dropbox.com/logo), using Dropbox blue |

These marks belong to Google and Dropbox, respectively, and are not covered by the Lucide license.
