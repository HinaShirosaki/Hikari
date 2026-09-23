---
name: "hikari-assay-plotly"
description: "Calculate, summarize, normalize and plot assay data with Hikari MCP. Style the live native Assay plot, add labels, reference lines and shaded bands, or revise a custom scratch graph. Use for active Assay context and user-provided assay rows."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:assay-plotly -->

# Hikari Assay Table and Plotly MCP

Turn the user's assay data into traceable calculations and an inspectable Plotly figure. Use the connected Hikari server's `assay_table` and `plotly_graph` tools, with the namespace exposed by the client. These tools manage scratch objects; their IDs do not identify saved Assay records.

Use `assay_plot` to style the native plot in Analyze or add labels, reference lines and shaded bands within that plot. It saves formatting on the active assay and returns live rendering acknowledgements. It does not calculate values or change plate measurements.

## Choose the relevant reference

- Read [tool-reference.md](references/tool-reference.md) for action arguments, returned objects, update semantics, and limits. The connected tool schemas are authoritative.
- Read [table-workflows.md](references/table-workflows.md) for active-context TSV intake, replicate summaries, blank correction, and control normalization.
- Read [plotly-recipes.md](references/plotly-recipes.md) when building dose/time plots, comparisons, distributions, plate heatmaps, or changing chart formatting.
- Read [python-transforms.md](references/python-transforms.md) when built-in calculations cannot express the requested transform, or when preparing a fit.
- Read [inspection-and-errors.md](references/inspection-and-errors.md) for the review loop, incomplete data, failed calls, or compatibility problems.
- Read [live-plot.md](references/live-plot.md) to style or annotate the native analysis plot.

Load only the references needed for the current task.

## Select the workflow

| User intent | Starting point |
| --- | --- |
| Calculate or plot the active plate | Parse the current Assay context TSV; create an original `assay_table` with explicit rows |
| Summarize replicate columns | `assay_table` → `derive` with row-wise `operands` |
| Summarize replicate wells | `assay_table` → `derive` with `group_by` and calculation-column `source` |
| Normalize, join controls, pivot, or fit | Built-in calculations when sufficient; otherwise `assay_table` → `python` after checking input completeness |
| Build a graph | Supply explicit `data`, `layout`, and optional `config` to `plotly_graph` → `create` |
| Restyle an existing graph | `plotly_graph` → `read`, then a scoped `update`, then `inspect` |
| Recover a scratch object | `list`, identify the correct object, then `read` by returned ID |
| Style or annotate the native analysis plot | `assay_plot` → `read`, then a style patch with the returned assay ID and revision |

## Establish the actual data

Use the active Assay right-rail context or user-provided rows. The current context can include unsaved plate mappings and pasted results. Parse its `Assay plate data (TSV...)` block directly; preserve `well`, `row`, `column`, `sample`, `concentration`, and `result` when present. A `Latest analysis table (TSV)` is already derived data: use it only when it matches the requested analysis, and avoid normalizing it twice.

Do not replace active plate context with local lookup results or a saved file that may be stale. If the context announces rows but supplies no body, request refreshed context or explicit rows. An assay name alone is not the data, and `create` does not retrieve the active plate implicitly.

Identify the measurement, units, grouping keys, controls, and meaning of replicates from the supplied data. Resolve only missing choices that materially change the calculation. Keep missing wells missing, keep measured zeroes, and do not invent control values or exclusions.

## Calculate, plot, and review

1. Create an original table when starting from assay rows, then derive named outputs. Reuse an existing verified table for follow-up work. `derive` and `add_column` both create a new table; capture each returned `table.id`.
2. Check `row_count`, `preview_truncated`, group counts, and a representative calculation. Table responses show at most 50 rows. Python staging currently has the same cap: read [python-transforms.md](references/python-transforms.md) before processing larger inputs.
3. Build traces from the actual calculation output. Label quantities and units, state whether error bars show SD, SEM, or an interval, and distinguish raw points from summaries and fitted predictions.
4. Call `inspect` after every graph creation or meaningful update. Review the returned figure and fix relevant issues; the inspector is a structural check, not proof of scientific validity or rendered appearance.
5. Use `read` when the full figure is needed after inspection. Report the returned table and graph IDs, transformation, replicate/error-bar definition, and material remaining limitations. Never use example IDs as live handles.

For a formatting-only request, preserve the existing data and calculation choices. In the active Assay rail, Hikari can display the returned graph artifact in the analysis output area in place of the built-in chart. That display does not by itself save an assay, change stored result values, or export an image file. Use canonical Plotly properties for scratch-figure edits; these are separate from Assay's native style-model settings. Keep the returned graph artifact available to Hikari; claim rendering, saving, or export only when that operation is confirmed.

Scratch tables and graphs live in the application service's memory and may disappear when it restarts. A chat artifact is not proof that its ID still resolves. Avoid `delete` or `clear` as routine cleanup; these actions remove scratch objects and `clear` is not scoped to the active plate.
