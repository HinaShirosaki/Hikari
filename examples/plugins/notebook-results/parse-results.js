// Parses an ImageJ Results table into a Hikari notebook result table.
//
// ImageJ writes Results as CSV (File > Save As...) and as tab-separated text
// when the window is copied to the clipboard, so the separator is sniffed from
// the header row.

// Notebook result tables key each cell by `field`, which must be a plain
// identifier. ImageJ headers are not: "Mean Gray", "%Area", and an empty first
// header for the row-number column all appear in normal output.
//
// Sanitizing can also collide — "Area" and "%Area" both reduce to `area` — and
// a collision silently overwrites the earlier column's values, so taken fields
// are suffixed rather than merged.
function toField(title, index, taken) {
  const base = title
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || `col_${index + 1}`;
  let field = base;
  let suffix = 2;
  while (taken.has(field)) {
    field = `${base}_${suffix}`;
    suffix += 1;
  }
  taken.add(field);
  return field;
}

function parseImageJResults(rawText) {
  // Blank lines go, but leading whitespace within a line must survive: ImageJ's
  // row-number column has an empty header, so a clipboard paste legitimately
  // starts with the separator and trimming the text would drop that column.
  const lines = String(rawText || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error('Paste the header row plus at least one measurement row.');
  }

  const separator = lines[0].includes('\t') ? '\t' : ',';
  const takenFields = new Set();
  const columns = lines[0].split(separator).map((header, index) => {
    const title = header.trim().replace(/^"|"$/g, '') || (index === 0 ? 'Label' : `Column ${index + 1}`);
    return { field: toField(title, index, takenFields), title };
  });

  const rows = lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(separator);
    const row = { id: `row_${rowIndex + 1}` };
    columns.forEach((column, index) => {
      row[column.field] = String(cells[index] ?? '').trim().replace(/^"|"$/g, '');
    });
    return row;
  });

  return { title: 'ImageJ measurements', columns, rows };
}

// Run with: node examples/plugins/notebook-results/parse-results.js
function demo() {
  const assert = (condition, message) => {
    if (!condition) {
      throw new Error(`parse-results self-check failed: ${message}`);
    }
  };

  // CSV, with ImageJ's nameless row-number column.
  const csv = parseImageJResults(' ,Area,Mean,%Area\n1,120.5,88.21,12\n2,98.0,91.44,10');
  assert(csv.columns.length === 4, 'four columns parsed');
  assert(csv.columns[0].field === 'label', 'empty first header becomes "label"');
  assert(csv.columns[3].field === 'area_2' && csv.columns[3].title === '%Area', '%Area collides with Area and is suffixed');
  assert(csv.rows.length === 2, 'two measurement rows');
  assert(csv.rows[0].area === '120.5', 'Area keeps its own value despite the collision');
  assert(csv.rows[0].area_2 === '12', '%Area lands in its own field');
  assert(csv.rows[1].id === 'row_2', 'rows carry sequential ids');

  // Clipboard form is tab-separated, and headers may contain spaces.
  const tsv = parseImageJResults(' \tMean Gray\n1\t88.21');
  assert(tsv.columns[1].field === 'mean_gray', 'spaces collapse to underscore');
  assert(tsv.rows[0].mean_gray === '88.21', 'tab-separated cells map to sanitized fields');

  // Every column must yield a non-empty field, or the host drops the table.
  assert(
    parseImageJResults(' , \n1,2').columns.every((column) => column.field),
    'punctuation-only headers still produce a usable field'
  );

  let rejected = false;
  try {
    parseImageJResults('Area,Mean');
  } catch {
    rejected = true;
  }
  assert(rejected, 'a header with no data rows is rejected');

  return 'ok';
}

if (typeof window !== 'undefined') {
  window.HikariNotebookResults = Object.freeze({ parseImageJResults });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { demo, parseImageJResults };
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('parse-results.js')) {
  console.log(demo());
}
