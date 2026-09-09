# Inspection, errors, and compatibility

## Review loop

After every graph create or meaningful update, inspect the returned ID:

```json
{"tool":"plotly_graph","arguments":{"action":"inspect","graph_id":"GRAPH_ID"}}
```

Read `inspection.issues`, `inspection.suggestions`, and trace summaries. Fix applicable problems with `update`, inspect again, and stop when the requested figure is correct or a specific unresolved limitation prevents completion. Do not repeat an unchanged request hoping inspection will pass.

`inspect` returns metadata without the figure. Read the stored figure when checking normalized arrays or revising a trace:

```json
{"tool":"plotly_graph","arguments":{"action":"read","graph_id":"GRAPH_ID"}}
```

For an expired/unknown handle, list scratch objects and match identity before choosing a replacement:

```json
{"tool":"assay_table","arguments":{"action":"list"}}
```

```json
{"tool":"plotly_graph","arguments":{"action":"list"}}
```

The tools allocate increasing string IDs in memory. They do not provide mutation revisions, idempotency keys, or persistence across service restarts. After an uncertain create/derive/python result, list/read and compare name, data, and timestamps before creating a duplicate. A reused ID after restart is not proof of the old object's identity.

## What inspection checks

The current inspector checks empty figures, selected missing trace arrays, scatter/bar x/y length mismatches, main title/axis coverage, `error_x.array`/`error_y.array` lengths, and unsorted finite numeric line x values. It flags numeric nonpositive values when the primary x/y axis is log scaled and suggests visible errors and named traces.

An empty issues list does **not** establish rendering, full Plotly property validity, or scientific correctness. Independently verify what matters for the current plot:

- Complete source/output rows and correct grouping/units; no accidental re-normalization.
- Error definition and point alignment, including `arrayminus`, nonnegative magnitudes, and log-scale error endpoints.
- Positive values on secondary log axes; the inspector's log checks use primary axes and do not fully resolve trace-axis assignments.
- Rectangular heatmap matrices with matching labels and correct plate orientation.
- Customdata/hover alignment, category labels, missing wells, and intentional point ordering.
- Actual fit/interval calculations when reporting modeled quantities.

Inspect rendered output through an available view/export path when appearance is part of the request. Otherwise report structural verification only. Do not imply the MCP inspector examined a screenshot or that a graph artifact was saved as a file.

## Failure handling

| Observed result | Next step |
| --- | --- |
| `invalid_arguments` | Compare the request with the connected schema. Remove unsupported fields and use exact public action/argument names. |
| `invalid_table` | Supply explicit nonempty rows. Context text or an assay name does not resolve to rows automatically. |
| `not_found` | Check the current service and list/read by identity; reconstruct only from complete known data if the object is gone. |
| `invalid_figure` | Supply an actual trace in `data`; layout alone cannot create a graph. |
| `executor_unavailable` | Report the unavailable application/Python executor. Use built-ins only if they can complete the requested calculation. |
| `invalid_python` | Supply code that writes `output_table.json`. |
| `python_failed` | Read sandbox error/stderr; fix the specific code, input, or package problem. A truncation-guard failure requires complete data, not removal of the guard. |
| `missing_output_table` | Write the expected file in the sandbox working directory; stdout is not readback. |
| `invalid_output_table` | Produce valid JSON in the documented table/row-array shape. Avoid NaN, Infinity, or a dataframe string. |
| `invalid_response`, unknown status, or `ok: false` | Treat execution as unconfirmed; preserve the error and resolve state before claiming success or retrying a mutation. |

Successfully parsed Python JSON can still normalize to an empty table if it has the wrong shape. Check expected columns and row counts after `python_completed`, not just status.

If preview/staging is incomplete, follow [python-transforms.md](python-transforms.md). If active TSV body rows are missing, obtain refreshed context or explicit rows; saved lookup data can miss current unsaved edits.

## Compatibility boundaries

Use public `table_id`/`graph_id` arguments and canonical `data`, `layout`, `config`. Internal fields such as `frames` and `normalization` may appear in runtime artifacts but are not all exposed through MCP. Read [tool-reference.md](tool-reference.md) before relying on them.

Scratch objects do not directly modify the native Assay result table, chart presets, saved experiment, or exported files. Use the actual available workflow for those requested operations and verify them separately. Do not silently clear/delete unrelated objects or write storage files to simulate a missing capability.

For an unfamiliar Plotly property, consult the relevant official Plotly.js reference, then verify the adjusted figure through the tool. Resolve the connected Hikari schema first for tool-argument problems; Plotly documentation does not define Hikari's top-level MCP fields.
