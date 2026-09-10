# Plotly recipes and formatting

## Choose the representation

| Data/question | Plot shape | Data requirement |
| --- | --- | --- |
| Dose or time response | Scatter markers, optionally lines connecting ordered observations | Numeric x with units; separate condition/subject traces |
| Independent conditions | Raw dots and/or a labeled summary; grouped bars when requested | Explicit category order and replicate/error definition |
| Distribution | Box/violin with raw observations | Individual values, not only precomputed means |
| Plate spatial pattern | Heatmap | Matrix indexed by physical row/column with missing wells preserved |
| Model fit | Observed markers plus a separate predicted line | Actual fitted parameters/predictions and fit diagnostics |

Connecting observed means does not fit a dose-response model. Avoid lines across unordered conditions or separate biological subjects. Keep raw observations available when useful for interpreting variation.

## Dose-response means with SD

This synthetic figure uses the two groups from [table-workflows.md](table-workflows.md). For this example only, supplied units are nM and RFU. Use actual returned values and actual units for a live request.

```json
{
  "tool": "plotly_graph",
  "arguments": {
    "action": "create",
    "name": "Example dose response",
    "data": [{
      "type": "scatter", "mode": "lines+markers", "name": "Compound A mean ± SD",
      "x": [1, 10], "y": [12, 22],
      "marker": {"size": 9, "color": "#4C78A8"},
      "line": {"width": 2, "color": "#4C78A8"},
      "error_y": {"type": "data", "array": [2, 2], "visible": true},
      "customdata": [[3], [3]],
      "hovertemplate": "Dose %{x:g} nM<br>Mean %{y:.2f} RFU<br>n=%{customdata[0]} wells<extra>%{fullData.name}</extra>"
    }],
    "layout": {
      "title": {"text": "Example dose response — mean ± SD"},
      "xaxis": {"title": {"text": "Concentration (nM)"}, "type": "log", "automargin": true},
      "yaxis": {"title": {"text": "Response (RFU)"}, "automargin": true},
      "showlegend": true
    },
    "config": {"responsive": true, "displaylogo": false}
  }
}
```

Then inspect the returned graph ID. Every mean, SD, and n must refer to the same group. `error_y.array` contains error magnitudes, not upper endpoints. For asymmetric intervals, use `symmetric: false`, upper magnitude in `array`, and lower magnitude in `arrayminus`; check both arrays and their alignment. [Plotly error bars](https://plotly.com/javascript/error-bars/).

Log axes require positive plotted values. Keep zero-dose/vehicle controls visible in a linear view, separate panel, or clearly reported control summary; do not replace zero with a tiny invented dose. On a logarithmic axis, explicit `range` endpoints are base-10 exponents: doses 0.1–100 correspond to `range: [-1, 2]`. Category axes preserve numeric-looking labels; set `categoryorder: "array"` and `categoryarray` for a specified order. [Plotly axis reference](https://plotly.com/javascript/reference/layout/xaxis/).

For raw wells, add a marker trace with `customdata` containing well ID, sample, and relevant dose/replicate metadata. Match customdata rows to point order; the Hikari runtime may sort line traces. Hover templates reference those fields using `%{customdata[0]}` etc. [Plotly hover formatting](https://plotly.com/javascript/hover-text-and-formatting/).

## Categorical comparisons and distributions

For a requested grouped bar plot, supply one `type: "bar"` trace per series and `layout.barmode: "group"`. Use a shared explicit category ordering. Stacked bars imply additive components; do not stack unrelated assay responses. Label error bars and include n when reporting a summary.

For a distribution, a trace such as `{"type":"box","name":"Vehicle","y":[8,10,11,14],"boxpoints":"all"}` uses underlying replicate values. Do not feed only means into a box plot and describe it as the distribution of wells. Paired measurements require retained pair identities; independent grouping alone loses pairing.

## Plate heatmap

Build `z[rowIndex][columnIndex]` from physical coordinates. Fill unmeasured cells with `null`; measured zero remains 0. Preserve the plate's actual dimensions and row labels. This synthetic 2×3 crop has A at the top, columns left-to-right, and one missing well:

```json
{
  "tool": "plotly_graph",
  "arguments": {
    "action": "create",
    "name": "Example plate crop",
    "data": [{
      "type": "heatmap",
      "x": ["1", "2", "3"], "y": ["A", "B"],
      "z": [[10, 0, null], [14, 20, 22]],
      "colorscale": "Viridis",
      "colorbar": {"title": {"text": "RFU"}},
      "hoverongaps": false,
      "hovertemplate": "Well %{y}%{x}<br>Response %{z:.2f} RFU<extra></extra>"
    }],
    "layout": {
      "title": {"text": "Example plate response (crop)"},
      "xaxis": {"title": {"text": "Plate column"}, "type": "category", "side": "top"},
      "yaxis": {"title": {"text": "Plate row"}, "type": "category", "autorange": "reversed"}
    },
    "config": {"responsive": true, "displaylogo": false}
  }
}
```

Use a common color range for quantitative plate comparisons; otherwise disclose independently scaled colors. A signed difference may call for a diverging scale centered on zero. Verify a rectangular matrix with exactly one row/column per y/x label. [Plotly heatmaps](https://plotly.com/javascript/heatmaps/).

## Revise formatting without recalculating

Read the graph first. A layout-only patch preserves traces; this example changes the y-axis label and tick display while preserving other axis properties:

```json
{
  "tool": "plotly_graph",
  "arguments": {
    "action": "update",
    "graph_id": "GRAPH_ID",
    "layout": {"yaxis": {"title": {"text": "Measured response (RFU)"}, "tickformat": ".1f", "automargin": true}},
    "config": {"responsive": true, "displaylogo": false}
  }
}
```

For trace changes, resend the full desired `data` list, including unchanged traces. See [tool-reference.md](tool-reference.md) for merge/replacement behavior and category preservation. Do not send Assay's native style-model keys or preset names as Plotly properties.

In the active Assay rail, graph artifacts can replace the visible analysis chart. The renderer applies Hikari's figure defaults to unspecified styling while retaining explicit figure choices. The stored MCP figure may therefore omit defaults visible on screen; inspect the rendered output when exact appearance matters.

Choose readable axis titles, visible contrast, concise legends, and enough margin for labels. Follow the user's formatting request. Configuring the modebar or an image filename only configures rendering/export controls; it does not create a file. For an exported PNG/SVG, use an available actual render/export path and verify that artifact separately.
