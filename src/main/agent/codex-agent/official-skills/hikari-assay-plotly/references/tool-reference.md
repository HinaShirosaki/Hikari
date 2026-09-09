# Assay and Plotly tool reference

## Public contract

Call `assay_table` and `plotly_graph` using the names exposed by the connected server. Examples use `{ "tool": "...", "arguments": {...} }` to identify the call; pass only `arguments` as its input. Replace example IDs with returned IDs.

Both schemas reject unknown top-level fields. Internal runtime aliases are not necessarily MCP arguments. Do not send `id`, `source`, `tableId`, `max_rows`, `limit`, `figure`, `traces`, `frames`, `output_path`, or `python_executable` unless a future connected schema explicitly exposes them.

Prefer IDs for existing targets. Names can be duplicated and name lookup chooses the first case-insensitive match. A failed ID can fall back to a supplied name, so omit unrelated names when reading a known target.

## `assay_table`

| Action | Supported input for the action | Result |
| --- | --- | --- |
| `create` | Nonempty `rows`; optional `name`, `columns` | New `table`, status `created` |
| `read` | `table_id` or existing `name` | `table`, status `read` |
| `list` | `action` only | Metadata `items`, `count`, `total_count`; no rows |
| `derive` | `table_id`, calculation `columns`; optional `output_name`, `group_by`, `keep_columns`, `include_source_columns` | New `table`, `source_table_id`, status `derived` |
| `add_column` | `table_id`, calculation `columns`; optional `output_name` | New table retaining source columns, status `derived` |
| `python` | `code`; normally `table_id`, optional `output_name` | New `table`, `source_table_id`, `sandbox`, status `python_completed` |
| `delete` | `table_id` or existing `name` | Deleted `id` |
| `clear` | `action` only | Number removed in `count` |

Use object rows for TSV conversion. Array rows require explicit ordered column names. `create.columns` selects the stored columns; omitting a key there drops that field. `derive.columns` instead contains calculation objects. `output_name` names a derived result; avoid overloading `name`, which also participates in target resolution and can rename a single `add_column` specification.

Calculation objects commonly use:

| Field | Meaning |
| --- | --- |
| `name` | Output column name |
| `op` | `+`, `-`, `*`, `/`, `max`, `min`, `avg`, `sd`, `median`, `count`, `log10`, `ln`, `pow`, or `copy` |
| `operands` | Row-wise input columns or numeric constants; `{"column":"rep1"}` and `{"value":100}` make the distinction explicit |
| `source` | Column to aggregate across a group, or to copy/read from a row |
| `scope: "table"` | Aggregate `source` over all source rows, even when grouping is present |

There is no arbitrary expression parser. One calculation cannot reference another column being created in the same `derive`: every calculation reads the original source row/group. Chain separate derivations for dependent calculations. Grouped output contains grouping columns plus calculation columns; `keep_columns` does not retain individual well records in a grouped result.

Numeric calculations accept finite numbers and numeric strings (commas are stripped). Blank and nonnumeric operands are discarded. This is useful for replicate averages but can produce a misleading partial sum, product, or subtraction when a required operand is missing. Validate required operands first or use Python with explicit missing-value handling.

`count` counts numeric observations, including zeroes, rather than all rows. `sd` uses sample SD (denominator n−1), but returns zero for fewer than two numeric observations. Treat that zero as undefined variability for n < 2. Division by zero, invalid logarithms, and unknown operations return blank cells rather than a calculation error.

Returned `table` fields are `id`, `name`, `source`, `columns`, `row_count`, `column_count`, timestamps, and (except listing) `rows` and `preview_truncated`. Null/nonfinite table cells become empty strings. Internal `source` provenance such as `derived:<id>` is returned, but the public schema does not accept a custom `source` field.

### Limits and completeness

- Up to 5,000 input rows and 200 columns; up to 20 grouping fields.
- Table names: 160 characters; column names: 120; cells: 4,000; Python code: 40,000.
- Serialized tables expose at most **50 rows**, even when stored `row_count` is larger. `read` has no public pagination or larger-preview parameter.
- Built-in `derive` processes the full stored table. Python staging currently serializes only the first 50 rows of each table; `tables.json` is not a full-data workaround.
- `list` returns the first 50 objects, with `total_count` indicating whether more exist. It exposes no paging parameter. Keep IDs from successful calls.

Do not construct a supposedly complete graph from a truncated preview. Use complete source rows already supplied, a valid smaller aggregate, or explicit complete data in Python as described in [python-transforms.md](python-transforms.md). Reject silent truncation beyond storage limits; splitting data requires preserving the analysis across all parts.

## `plotly_graph`

| Action | Supported input for the action | Result |
| --- | --- | --- |
| `create` | Nonempty `data`; optional `name`, `layout`, `config` | New `graph`, status `created` |
| `read` | `graph_id` or existing `name` | `graph` including `figure` |
| `list` | `action` only | Graph metadata/inspection in `items`; no figures |
| `update` | `graph_id`; optional `name`, `data`, `layout`, `config`, `replace` | Updated `graph` including `figure` |
| `inspect` | `graph_id` or existing `name` | Top-level `inspection`, `id`, and graph metadata; no figure |
| `delete` | `graph_id` or existing `name` | Deleted `id` |
| `clear` | `action` only | Number removed in `count` |

`data` accepts up to 80 trace objects. `layout` and `config` accept Plotly properties, but the tool does not fully validate them against Plotly's schema. The MCP schema exposes no file export, figure rendering, saved-assay writeback, table-ID data binding, or animation-frame argument. Trace arrays must contain explicit values.

Returned `graph` includes `id`, `name`, `source`, timestamps, `inspection`, and, for create/read/update, `figure` with `data`, `layout`, `config`, `frames`. An output field's presence does not mean the input schema accepts that field.

### Updating without losing information

- A nonempty `data` array replaces the **entire trace list**, even with `replace: false`. Read the graph and resend all desired traces when changing one trace's marker, error bars, or hover text.
- By default, nonempty `layout` and `config` objects merge recursively. Arrays inside them are replaced, not merged by index. Send nested objects, such as `{"yaxis":{"title":{"text":"Response"}}}`, not relayout-style dotted keys.
- `replace: true` replaces each supplied nonempty layout/config object. Omitted objects remain. Empty `data`, `layout`, or `config` does not clear that component. Do not interpret `replace` as a full figure reset.
- When replacing traces with numeric-looking category labels, include the category-axis declaration in that same update. Incoming traces are normalized before the existing layout is merged; relying only on the old category setting can lose labels such as `"001"`.

### Normalization

Numeric-or-blank x/y/z and error arrays become numbers/null gaps; genuinely mixed label arrays remain as supplied. Explicit category axes preserve numeric-looking x/y labels. The graph parser does not strip thousands separators as the table calculator does: supply actual numbers consistently.

Line traces with at least two finite numeric x values are sorted by ascending x unless `selectedpoints` is present. Matching per-point arrays, including y, text, customdata, marker attributes, and error arrays, move with the points. Marker-only scatter and bar traces keep their order. Gapped/non-numeric x arrays are not automatically sorted. Prepare nonmonotonic trajectories or categorical sequences explicitly rather than expecting this dose-series behavior to preserve acquisition order.

Use the returned `graph.figure` for point positions after create/update. The internal runtime emits `normalization` notes, but the current direct MCP wrapper does not forward that top-level field; do not depend on receiving it.
