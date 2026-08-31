# Overlapping-window screenshot audit

Captured from the generated host markup and bundled Gel markup with their production CSS at 1280 x 800. Empty data-driven areas remain empty because the screenshot harness does not create application records.

## Contact sheets

- [Windows 1-15](contact-sheet-1.png)
- [Windows 16-30](contact-sheet-2.png)

## Individual screenshots

| # | Window | Screenshot |
|---:|---|---|
| 1 | Sequence Viewer - Add Feature | [PNG](01-sequence-viewer-feature-editor-overlay.png) |
| 2 | Sequence Viewer - Edit Bases | [PNG](02-sequence-viewer-sequence-edit-overlay.png) |
| 3 | Sequence Viewer - Backbone / Insert Candidates | [PNG](03-sequence-viewer-backbone-dialog-overlay.png) |
| 4 | Sequence Viewer - Designed Primers | [PNG](04-sequence-viewer-primer-design-overlay.png) |
| 5 | Sequence Viewer - Order Primers | [PNG](05-sequence-viewer-primer-order-overlay.png) |
| 6 | Vector Builder - Replace Feature | [PNG](06-sequence-viewer-vector-builder-feature-replace-overlay.png) |
| 7 | Vector Builder - Edit Bases | [PNG](07-sequence-viewer-vector-builder-sequence-edit-overlay.png) |
| 8 | Sequence Viewer - Alignment Workspace | [PNG](08-sequence-viewer-alignment-workspace.png) |
| 9 | Protein Builder - Assemble Plasmid | [PNG](09-sequence-viewer-protein-builder-assembly-overlay.png) |
| 10 | Chemicals - Add Chemical | [PNG](10-chemical-dialog-overlay.png) |
| 11 | Agent - Review Generated Drafts | [PNG](11-agent-review-overlay.png) |
| 12 | Home - Cell Passage | [PNG](12-dashboard-passage-dialog-overlay.png) |
| 13 | Home - Start Timer | [PNG](13-dashboard-timer-dialog-overlay.png) |
| 14 | Home - Add Note | [PNG](14-dashboard-notebook-note-dialog-overlay.png) |
| 15 | Home - Overnight Incubation | [PNG](15-dashboard-incubation-dialog-overlay.png) |
| 16 | Assay - Serial Dilution | [PNG](16-assay-serial-dilution-overlay.png) |
| 17 | Assay - Select Result Matrix | [PNG](17-assay-result-import-overlay.png) |
| 18 | Save changes before quitting | [PNG](18-unsaved-changes-overlay.png) |
| 19 | Inventory - Add Container | [PNG](19-inventory-add-container-overlay.png) |
| 20 | Protocol - Import JSON | [PNG](20-protocol-json-import-overlay.png) |
| 21 | Protocol - Generate Input | [PNG](21-protocol-generate-input-overlay.png) |
| 22 | Protocol - Generated Result | [PNG](22-protocol-generate-result-overlay.png) |
| 23 | Protocol - Polish | [PNG](23-protocol-polish-overlay.png) |
| 24 | Notebook - Add Table | [PNG](24-biology-notebook-table-size-overlay.png) |
| 25 | Notebook - New Experiment | [PNG](25-biology-notebook-experiment-dialog-overlay.png) |
| 26 | Notebook - Quick Add Sample | [PNG](26-biology-notebook-quick-sample-overlay.png) |
| 27 | Notebook - Add Project | [PNG](27-biology-notebook-project-dialog-overlay.png) |
| 28 | Gel - Per-Cell Band Intensity | [PNG](28-gel-cell-table-overlay.png) |
| 29 | Gel - Analysis Report | [PNG](29-gel-report-overlay.png) |
| 30 | Gel - Lane Peak Area | [PNG](30-gel-peak-editor-overlay.png) |

## Narrow-window geometry test

Host dialogs were tested at 800 x 600, where the dock wraps and ends at y = 156.39 px.

- All 27 host dialogs now start below the dock and expose reachable overflow.
- All three Gel dialogs stay inside their plugin viewport; that viewport already begins below the host dock.
- The three corrected Protocol dialogs now begin at y = 169 px:
  - [Fixed Protocol contact sheet](fixed-protocol-contact-sheet.png)
  - [Fixed Generate input](fixed-narrow-protocol-generate-input-overlay.png)
  - [Fixed Generated result](fixed-narrow-protocol-generate-result-overlay.png)
  - [Fixed Polish](fixed-narrow-protocol-polish-overlay.png)
- Pre-fix evidence remains available for comparison: [Generate input](narrow-protocol-generate-input-overlay.png), [Generated result](narrow-protocol-generate-result-overlay.png), and [Polish](narrow-protocol-polish-overlay.png).
- [Host geometry data](host-geometry-800x600.json)
- [Gel geometry data](gel-geometry-800x600.json)
- [Focused fixed Protocol geometry](fixed-protocol-geometry-800x600.json)

## Deliberately long stress case

The 40-row stress dialog was tested at 800 x 600. The dock ended at y = 179.27 px; the dialog began at y = 186.5 px and ended at y = 576.5 px. Its content scroll height was 1684 px inside a 388 px client area, so the title and close control opened below the dock and the full content remained reachable.

- [Long-dialog screenshot](31-long-dialog-stress.png)
- [Long-dialog geometry](long-dialog-geometry-800x600.json)
