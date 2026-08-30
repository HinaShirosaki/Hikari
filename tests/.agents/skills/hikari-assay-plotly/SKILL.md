---
name: "hikari-assay-plotly"
description: "Use Hikari MCP assay_table and plotly_graph to turn assay data into calculated tables and inspectable Plotly.js graphs."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:assay-plotly -->

# Hikari Assay Table and Plotly MCP

Use this skill when the user asks to calculate, summarize, normalize, compare, graph, or re-plot assay data. It is especially useful inside the Assay right rail, where the active plate/results context is supplied automatically.

Direct tools:

- `assay_table` — create scratch assay tables, derive calculated tables, add calculated columns, and run Python-backed table transforms.
- `plotly_graph` — create, update, read, and inspect Plotly.js graph specifications from regular Plotly figure arguments.

Table workflow:

1. Start from the active assay context or user-provided data and create an original table with `assay_table`.
   - In the Assay right rail, the active assay context includes TSV blocks such as `Assay plate data (TSV...)` and sometimes `Latest analysis table (TSV)`.
   - To retrieve the data in a chat turn, find the `Assay plate data (TSV...)` block in the hidden context, read the header line, then parse each following non-empty TSV row until the next blank line or section. Each row becomes one object for `create`.
   - Convert that TSV into explicit `rows` for `create`; do not omit `rows` and merely refer to the active assay.
   - Preserve the columns `well`, `row`, `column`, `sample`, `concentration`, and `result` when they are present, because downstream calculations and Plotly traces often need the plate location as well as values.
   - If the block says rows exist but no body rows are present, say the active assay context omitted the row data and ask for a refreshed context.
   - Do not use local lookup tools to fetch the active assay plate data; the current plate data must come from the right-rail context TSV or from user-provided rows.
2. Use `derive` or `add_column` for common calculations: `+`, `-`, `*`, `/`, `max`, `min`, `avg`, `sd`, `median`, `count`, `log10`, `ln`, and `pow`.
3. Use row-wise `operands` when each row contains replicate columns. Example:
   `{ "action": "derive", "table_id": "1", "include_source_columns": true, "columns": [{ "name": "avg_response", "op": "avg", "operands": ["rep1", "rep2", "rep3"] }, { "name": "sd_response", "op": "sd", "operands": ["rep1", "rep2", "rep3"] }] }`
4. Use `group_by` plus `source` on each calculation-column object for grouped summaries. Example:
   `{ "action": "derive", "table_id": "1", "group_by": ["condition", "dose"], "columns": [{ "name": "mean", "op": "avg", "source": "response" }, { "name": "sd", "op": "sd", "source": "response" }, { "name": "n", "op": "count", "source": "response" }] }`
5. Use the `python` action only when built-in calculations are not enough. The tool stages `input_table.json` and `tables.json`; your code must write `output_table.json` with `{ "columns": [...], "rows": [...] }` or a JSON array of row objects. Prefer `python3`; the runtime falls back to `python` when needed.

Plotly workflow:

1. Build the table first when calculations, grouping, normalization, or replicate summaries are needed.
2. Call `plotly_graph` with `action: "create"` and canonical Plotly arguments: `data`, `layout`, and optional `config`. Example:
   `{ "action": "create", "name": "dose response", "data": [{ "type": "scatter", "mode": "markers", "x": [1, 10], "y": [20, 75] }], "layout": { "title": { "text": "Dose response" } }, "config": { "responsive": true, "displaylogo": false } }`
3. Call `inspect` after every `create` or meaningful `update`. Treat returned `issues` and `suggestions` as the graph review loop.
4. Use `update` to adjust titles, axes, trace names, colors, error bars, log axes, or hover labels before answering.
5. In the final response, report the table id and graph id, and summarize the decisions made during inspection.

Common Plotly settings:

- Title: `layout.title.text`, with concise assay name and measurement.
- Axes: `layout.xaxis.title.text`, `layout.yaxis.title.text`, and `layout.yaxis.type: "log"` only when log scaling is scientifically appropriate.
- Scatter/line: `{ "type": "scatter", "mode": "markers" }`, `"lines+markers"` for trends, and `marker.size` around 8-11.
- Bar: `{ "type": "bar" }`, `layout.barmode: "group"` for side-by-side groups, `"stack"` only for additive quantities.
- Error bars: `error_y: { "type": "data", "array": [...], "visible": true }` for SD/SEM arrays.
- Dose response: use numeric dose on x, response on y, clear units, and log x-axis only if the dose spacing is logarithmic.
- Hover: set `hovertemplate` when well id, condition, dose, or replicate count matters.
- Export/render config: use `config: { "responsive": true, "displaylogo": false }` unless the user asks otherwise.

If these common settings are not enough, search the official Plotly.js documentation at the end of your reasoning loop, then return to `plotly_graph` with the adjusted figure.
