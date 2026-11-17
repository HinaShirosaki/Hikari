# Flow Cytometry for Hikari

Open local flow cytometry event files, view event density,
histograms, or 3D scatter plots, and define gates. Files in a folder share
plot settings and gates as you switch between them in the left rail.

## Install

In Hikari, go to **Settings → Plugins → Add Plugin Folder** and select this
`flow-cytometry` folder. Click **Reload App**, then open **Flow Cytometry** from
the dock, **More**, or Hikari search. The plugin uses `layout` for the
workspace rail and `downloads` for native export dialogs. If Flow
Cytometry was installed before exports were added, remove and re-add the
plugin folder before reloading Hikari so it picks up the new permission.

## Analyze a file

1. Click **Open files** or drop files onto the workspace. Select a file in the
   left rail to view it. **Try example folder** opens three synthetic FCS files.
2. Select a **Channel** and **Scale** for each axis. **Auto range** fits the data
   for that scale. To zoom, enter Min and Max in recorded channel units and
   click **Apply range**. Log₁₀ shows positive values; arcsinh (cofactor 150)
   can show zero and negative values.
3. Choose an icon in the **Gate tools** toolbar. Drag for freehand, click
   three vertices for a triangle, or drag from the center to the edge for a
   circle. To draw a polygon, click the vertices and click the first point
   again, press Enter, or select **Close polygon**. For a split or quadrants,
   click where the line or intersection should go. Press Esc to cancel.
4. Completed gates appear as cell groups under the data file in the left rail.
   Each side of a split or quadrant is selectable. Select a group to plot
   its events and draw gates within that group. Select the file to see all events.
5. Gate percentages appear on the plot and in the file rail. Each percentage
   uses the parent file or cell group as its denominator. Click **…** beside a
   group to rename the gate, choose **Show on plot** to restore its axes, or
   choose **Remove gate** to delete the gate and its child groups.
6. Drag a gate to move it. Click it to show handles: drag a circle's edge
   handle to resize it, a triangle or polygon vertex to reshape it, or a
   freehand corner to resize the outline. Drag a split line on its own or
   drag a quadrant intersection to move both lines. Press Esc to cancel a
   drag. Editing a shared gate recalculates it and its child groups across
   the folder.

Select **Histogram** above the plot to see the distribution of a single
channel in the active file or group. Set the X channel, scale, range, and
number of bins. Bins are evenly spaced on the displayed scale. Choose
**Light**, **Medium**, or **Strong** smoothing to draw a curve through
smoothed bin counts. Choose **Off** for the original bars. Select
**Density** to draw gates.

In **Histogram settings**, choose **Overlay…** and select up to five
additional files or cell groups. All traces use the current X channel,
scale, range, bin count, and smoothing. Choose **Percent of in-range
events** to compare distributions from sources with different event
totals. Folder plots keep their shared X range. For a file outside a
folder, **Auto range** fits the selected traces.

Select a cell group in the left rail and choose **3D Scatter**. Set the
channel, scale, and range for **X**, **Y**, and **Z** independently. Drag
the plot or use the arrow keys to rotate it. Use **Reset view** to return to
the starting angle. Point color shows relative local density across the
three displayed axes, from blue for sparse regions to red for dense
regions. Groups with more than 30,000 events in range show a sample of
30,000 points. The density colors use all in-range events.

## Arrange plots in layouts

Use the **New layout** icon beside a folder in the left rail, or choose
**Add to layout…** on a plot to pick or create a layout in its folder.
For a file outside a folder, choose an existing folder as the destination.
Layouts sit alongside the data files in their folder in the left rail.
You can add density plots, histograms and overlays, or 3D scatter plots
from files and cell groups. Each snapshot captures the current axes, gates
or legend, and any 3D rotation. Snapshots remain available after you close
their source file.

Set the number of columns and drag a plot by its header to reorder it.
The arrow buttons also change the order, and the layout icon lets a plot
span two columns. Use **Export PNG** to save the layout as one image or
**Export PDF** to save a document that keeps each row of plots together.
Both use Hikari's save dialog and include plot titles, axes, and legends.
Layouts remain available for the current session.

## Share gates across files

Use **Open data folder** in the left rail to import a disk folder, or use
**New folder** to create an empty folder in the workspace. The plus button
beside a folder adds data files to it. You can also drop files from your
computer or drag an unfiled sample from the rail onto a folder. Gates from
a moved sample join the folder's gates.

Drawing, renaming, or removing a gate in any file updates the folder's
gates, including nested gates. New files inherit the existing gates.
Each file counts its own events. Gates use matching channel names and
preserve the scales and thresholds from the file where they were drawn.
If a channel is missing or does not match, the affected file shows a notice.

Files and cell groups in a folder share X, Y, and Z channels, scales, and
ranges across the plot types. **Auto range** fits the open files in the
folder. If a file lacks a selected detector, its plot shows which axis
needs attention. **Show on plot** temporarily restores the axes used to
draw it. Choose **Use folder axes** to return to the shared view.

Use the **Channel names** tag button beside a folder or in the **Axes**
panel to assign an alias such as **CD19** to **B525**. All files in the
folder use that alias in selectors, plots, and gate settings during the
session. The detector name is still displayed alongside the alias. Clear
an alias to restore the file’s label. Aliases apply to an individual file
when it is outside a folder.

The bundled `examples/CD19 panel` folder has **Unstained.fcs**,
**Mixed cells.fcs**, and **CD19-enriched.fcs**. **Try example folder**
opens them with the B525 alias already set to CD19. You can also open
the folder from disk through **Open data folder**.

The plot bins all in-range events into a density grid. Gate counts use the
individual events and the axes in use when the gate was drawn, so zooming or
changing scale does not change membership.
Splits and quadrants also count events beyond the visible ranges if they can
be plotted on the original scales. Events on a dividing line go to the right
or upper region.

## File support

- **FCS and FCS-compatible LMD.** The reader handles binary list-mode FCS
  2.0, 3.0, 3.1, and 3.2 with byte-aligned 8/16/24/32-bit unsigned
  integers, 32/64-bit floating point, and FCS 3.2 per-channel numeric
  types. Multi-dataset files open at the first dataset. Use the original
  event export for binned histogram files, or re-export legacy ASCII,
  bit-packed, and mixed-byte-order files as standard binary FCS.
- **CSV, TSV, and delimited TXT.** Use one row per event and one column
  per channel. An optional first row supplies channel names. Files with
  a numeric first row get numbered channels. UTF-8 and BOM-marked UTF-16
  are supported. Delimiters can be comma or semicolon for CSV, tab for
  TSV, and any of the three for TXT. Semicolon-separated tables can use
  decimal commas. Blank, NA, N/A, NaN, and null measurements are treated
  as missing. The plot uses the values as exported, including any
  compensation or scale changes applied by the export tool. Use consistent
  detector names in headers to share axes and gates with other files.
- **Gzip.** You can import single gzip-compressed files in the same formats,
  for example sample.fcs.gz or events.csv.gz.

For a workspace or summary report, export the source samples or populations
as event files. The reader limits files to 256 MiB each, including decoded
event data, and keeps at most 512 MiB of open event data per session.

The reader accepts named spillover in `$SPILLOVER`, `$SPILL`, `$COMP`, and
their unprefixed variants in the primary or supplemental TEXT segment.
It matches detector names, unique stain labels, and lists of one-based
acquisition parameter numbers. If the file has several recognized
keywords, the reader prefers a valid `$SPILLOVER` matrix and uses one matrix.
The file notice identifies the keyword used.

Legacy acquisition metadata such as numeric `$COMP` and `$DFCiTOj` is
reported with the recorded values. The reader also shows recorded values
when a matrix is ambiguous or invalid, is an identity matrix, includes
logarithmically stored channels, or is disabled by SpectroFlo metadata.
Files and gates remain in memory until closed or the plugin reloads.
Analysis runs locally. Unadjusted channels use the recorded numeric values.

See the [ISAC FCS standards](https://isac-net.org/data-standards/),
[FCS compensation guidance](https://onlinelibrary.wiley.com/doi/full/10.1002/cyto.a.20637),
[FlowJo event export guide](https://docs.flowjo.com/flowjo/workspaces-and-samples/samples-and-file-types/ws-export/),
and [Cytobank event export guide](https://support.cytobank.org/hc/en-us/articles/205201928-Export-data-as-FCS-or-spreadsheet-files-from-whole-files-and-or-gated-populations).

## Checks

- `node tests/flow-cytometry-selfcheck.mjs`
- `node node_modules/electron/cli.js tests/flow-cytometry-electron.cjs`

The self-check enforces 200–500 lines per first-party code file, including
HTML, CSS, and the plugin tests. Manifests, icons, docs, and `vendor/` assets
keep their own formats.

`main.mjs` connects the workspace and host controls. `file-rail.mjs` manages
file and folder imports, and `gate-library.mjs` manages shared gate definitions
and their per-file results. `gate-drawing.mjs` handles drawing gestures and
`plot.mjs` renders the charts and overlays. `analysis.mjs` runs calculations
in a worker. `event-file.mjs` reads imports, using `fcs.mjs` for binary FCS
and LMD data. The example FCS files are synthetic.
`layout-editor.mjs` captures and arranges plots.
