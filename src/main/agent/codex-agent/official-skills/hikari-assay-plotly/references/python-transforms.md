# Python transforms and model fitting

## When Python is useful

Use built-in calculations for simple arithmetic and summaries. Use `assay_table` with `action: "python"` for matched-control joins, conditional missing values, reshaping, or requested statistical/model calculations the built-ins cannot express.

The tool stages `input_table.json` (resolved source table, or `{}` if none resolves) and `tables.json` (serialized scratch tables). It runs code and reads `output_table.json`. Write either `{"columns":[...],"rows":[...]}` or an array of row objects. A plot image, printed dataframe, Python figure, or stdout alone does not create the output table.

The public inputs for this action are `action`, `table_id`, `code`, and optional `output_name`/`name`. Do not pass hidden runtime options such as executable paths, output paths, or timeout values. The application selects its Python sandbox; package availability must be established there, not inferred from another shell or environment. Prefer standard-library code for small transforms.

## Check completeness before calculating

Current staging calls the preview serializer, which caps each table at **50 rows** even when asked for more. Check both `preview_truncated` and `row_count == len(rows)` before using a staged source. Check each table separately in `tables.json`. A correct transform over incomplete inputs is still incomplete analysis.

When data exceeds that cap:

- Built-in `derive` still processes all stored rows; use it if it expresses the operation and its complete output fits the response.
- If complete user/context rows are already available, embed those exact rows as a JSON literal in the Python code, within the 40,000-character code limit. Record that source explicitly in the response and validate its count. Do not reconstruct missing rows from the preview.
- Otherwise request complete data through an available authorized input path or explain the missing-data limitation. Repeated `read`, an unsupported `max_rows`, and `tables.json` do not recover omitted rows.

Output is stored with the same 5,000-row/200-column limits and returned with a 50-row preview. Check output size before writing, and do not silently slice data to fit.

The sandbox also caps each readback file at 60,000 characters. Large `output_table.json` files can therefore fail JSON parsing even within the row limit. Use compact JSON or a legitimately smaller output, check warnings, and retain complete observations rather than silently dropping rows to fit.

## Executable grouped mean, SD, and SEM example

Use the raw six-well table from [table-workflows.md](table-workflows.md), substituting its actual ID. This code checks completeness, keeps measured zeroes, excludes only explicitly missing responses, rejects other invalid numeric values, and records n. It returns null variability for n < 2 (stored as blank cells by the table runtime).

```json
{
  "tool": "assay_table",
  "arguments": {
    "action": "python",
    "table_id": "RAW_TABLE_ID",
    "output_name": "Example Python dose summary",
    "code": "import json, math, statistics\nfrom collections import defaultdict\nfrom pathlib import Path\n\ntable = json.loads(Path('input_table.json').read_text())\nrows = table.get('rows', [])\nif table.get('preview_truncated') or table.get('row_count') != len(rows):\n    raise ValueError('Input table is missing rows; provide complete source data')\nif not rows:\n    raise ValueError('Input table has no rows')\n\ndef number(value):\n    if value is None or (isinstance(value, str) and not value.strip()):\n        return None\n    if isinstance(value, bool):\n        raise ValueError('Boolean response is not a measurement')\n    result = float(value)\n    if not math.isfinite(result):\n        raise ValueError('Nonfinite measurement')\n    return result\n\ngroups = defaultdict(list)\nfor row in rows:\n    sample = row.get('sample')\n    dose = number(row.get('concentration'))\n    if not sample or dose is None:\n        raise ValueError('Missing sample or concentration')\n    values = groups[(sample, dose)]\n    response = number(row.get('result'))\n    if response is not None:\n        values.append(response)\n\noutput = []\nfor (sample, dose), values in sorted(groups.items()):\n    n = len(values)\n    sd = statistics.stdev(values) if n >= 2 else None\n    output.append({'sample': sample, 'concentration': dose, 'mean': statistics.mean(values) if n else None, 'sd': sd, 'sem': sd / math.sqrt(n) if sd is not None else None, 'n': n})\nif len(output) > 5000:\n    raise ValueError('Output exceeds table row limit')\nPath('output_table.json').write_text(json.dumps({'columns': ['sample', 'concentration', 'mean', 'sd', 'sem', 'n'], 'rows': output}, allow_nan=False))\n"
  }
}
```

Verify two output groups for that example: means 12/22, SD 2, n 3, and SEM 2/√3. For another dataset, adapt grouping keys and numeric conventions. The example rejects numeric strings with unit suffixes or thousands separators; establish the source format before stripping anything.

## Matched controls and dependent calculations

Build a control lookup keyed by the required plate/batch/sample fields. Require every source row to resolve to its intended control set, calculate the defined control summary, and reject missing or zero denominators. Preserve original measurements and derived columns. Do not average unmatched controls together as a fallback.

Calculate dependent values explicitly in Python or use successive built-in derivations. `assay_table` does not evaluate newly named columns in sequence within one `derive` call.

Use JSON null for undefined outputs and `allow_nan=False` when serializing. Do not replace failed fits or missing estimates with numeric zero. Inspect `sandbox.stderr` and warnings even when an output table was produced.

## Requested curve fitting or statistical comparisons

Neither tool automatically performs or validates a fit. Establish independent variable, response, model, units, replicate level, weighting, and requested parameter before fitting. A log axis changes display; it does not log-transform data used by a model. Preserve controls and missing-data decisions separately from axis choices.

Check the required library in the actual sandbox. Report optimizer success, fitted parameters/units, parameter bounds, included observation count, residual behavior, and identifiability/extrapolation limitations relevant to the conclusion. A smooth line or high goodness-of-fit number alone does not establish an EC50/IC50 or biological effect. Do not invent fitted values when execution fails.

Keep observed data and model predictions in distinct output columns or tables and distinct Plotly traces. Evaluate predictions on an explicit x grid within the justified domain, retaining observed uncertainty separately from any fitted interval. For a comparison or interval, identify the actual statistical method and independent sample count; technical replicate wells do not add independent samples.
