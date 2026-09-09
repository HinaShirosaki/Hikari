# Assay intake and calculation workflows

## Active plate TSV

Find the current `Assay plate data (TSV...)` section in the supplied Assay context. Read its header and following nonempty TSV lines until the section ends. Split on tabs, retaining empty cells, and map values by header name. Do not split on general whitespace or trim away trailing empty fields. Preserve identifiers as text and parse measurements only when their units and numeric format are known.

Check the announced row count against the supplied rows. Keep well coordinates and sample/concentration metadata. Record which table is raw and which is a derived `Latest analysis table (TSV)`. Missing wells, nonnumeric flags, and excluded observations are different states; do not convert them all to zero.

The following synthetic example represents six explicitly supplied wells; its numbers are not live assay data.

```json
{
  "tool": "assay_table",
  "arguments": {
    "action": "create",
    "name": "Example raw wells",
    "columns": ["well", "row", "column", "sample", "concentration", "result"],
    "rows": [
      {"well":"A1","row":"A","column":1,"sample":"Compound A","concentration":1,"result":10},
      {"well":"B1","row":"B","column":1,"sample":"Compound A","concentration":1,"result":12},
      {"well":"C1","row":"C","column":1,"sample":"Compound A","concentration":1,"result":14},
      {"well":"A2","row":"A","column":2,"sample":"Compound A","concentration":10,"result":20},
      {"well":"B2","row":"B","column":2,"sample":"Compound A","concentration":10,"result":22},
      {"well":"C2","row":"C","column":2,"sample":"Compound A","concentration":10,"result":24}
    ]
  }
}
```

Save `table.id` as `RAW_TABLE_ID`. Use units supplied separately by the user/context in plot labels; a number alone does not establish nM, minutes, or RFU.

## Replicate wells: long format

Group by the scientific condition, including dose/time/batch where relevant. Do not group by well when combining replicate wells, and do not average across plates or biological samples accidentally.

```json
{
  "tool": "assay_table",
  "arguments": {
    "action": "derive",
    "table_id": "RAW_TABLE_ID",
    "output_name": "Example dose summary",
    "group_by": ["sample", "concentration"],
    "columns": [
      {"name":"mean","op":"avg","source":"result"},
      {"name":"sd","op":"sd","source":"result"},
      {"name":"n","op":"count","source":"result"}
    ]
  }
}
```

For the complete six-row example, expect two groups: dose 1 → mean 12, SD 2, n 3; dose 10 → mean 22, SD 2, n 3. Keep the original well table for raw-point hover and provenance. The grouped result has no single well identity.

Technical wells are not automatically independent biological replicates. For a summary across biological samples, summarize technical repeats within each sample first, then summarize those independent sample values. State what n counts.

## Replicate columns: wide format

When one row contains `rep1`, `rep2`, and `rep3`, use operands instead of grouping. Here `WIDE_TABLE_ID` refers to a separately created table with those column names.

```json
{
  "tool": "assay_table",
  "arguments": {
    "action": "derive",
    "table_id": "WIDE_TABLE_ID",
    "output_name": "Example row replicate summary",
    "include_source_columns": true,
    "columns": [
      {"name":"mean","op":"avg","operands":["rep1","rep2","rep3"]},
      {"name":"sd","op":"sd","operands":["rep1","rep2","rep3"]},
      {"name":"n","op":"count","operands":["rep1","rep2","rep3"]}
    ]
  }
}
```

`sd` is sample SD. For requested SEM, calculate `sd / sqrt(n)` only for n ≥ 2; label it SEM. Do not reinterpret the runtime's zero SD at n = 0 or 1 as a measured error bar. Use Python for conditional missing-value handling, or separate derivations (`pow` with exponent 0.5, then division) after resolving under-replicated groups. Confidence intervals require an explicit interval method; neither SD nor SEM is automatically a 95% interval.

## Blank correction and control normalization

Select actual blank/control records and the intended plate/batch/condition matching. A blank estimates background; a vehicle or reference control defines a comparison. They are not interchangeable. Preserve negative blank-corrected values unless an explicit assay rule says otherwise.

For a verified numeric `blank_mean` already joined to every source row:

```json
{
  "tool": "assay_table",
  "arguments": {
    "action": "add_column",
    "table_id": "CONTROL_JOINED_TABLE_ID",
    "output_name": "Example blank corrected wells",
    "columns": [{"name":"corrected","op":"-","operands":["result","blank_mean"]}]
  }
}
```

This returns a new table. Do not pass a missing `blank_mean` to subtraction: the calculator can discard the missing operand and return the uncorrected result. To join controls by plate/batch or enforce complete pairs, use [python-transforms.md](python-transforms.md).

Possible transformations, when they match the user's question:

| Requested quantity | Definition to record |
| --- | --- |
| Blank-corrected signal | measured signal − matched blank mean |
| Relative response (%) | 100 × corrected signal / matched corrected reference |
| Fold change | corrected signal / matched corrected reference |
| Percent inhibition | 100 × (1 − corrected signal / matched corrected reference), only for the stated inhibition convention |
| Min/max scaling (%) | 100 × (signal − defined low control) / (defined high control − defined low control) |

Require a valid nonzero denominator. Do not clip to 0–100, delete outliers, impute values, or infer an inhibition direction merely to make a plot look cleaner. Retain the formula and control identity in the derived name or response explanation. Normalize at the correct replicate level; averaging ratios and taking a ratio of means need not produce the same result.

## Hand the actual output to Plotly

Read returned rows and counts before constructing traces. A graph takes explicit arrays, not `table_id` or column-binding expressions. Group traces by sample/condition and align means, errors, n, and hover values from the same rows. See [plotly-recipes.md](plotly-recipes.md).

When the summary has more than 50 rows, the response is incomplete even though built-in grouping used all source rows. Use the complete source already supplied to construct the full output, or another valid route described in [tool-reference.md](tool-reference.md); never plot the preview as the entire result.
