export const ASSAY_CONTEXT_COLUMNS = ['well', 'row', 'column', 'sample', 'concentration', 'result'];

// Plate values travel as structured IPC data, independently of prompt previews.
// Reject oversized inputs instead of silently turning them into partial plates.
export function normalizeAssayContextTable(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value.rows) || value.rows.length > 1536) {
    throw new Error('Active plate context must contain at most 1536 rows.');
  }
  if (JSON.stringify(value.columns) !== JSON.stringify(ASSAY_CONTEXT_COLUMNS)) {
    throw new Error('Active plate context has unexpected columns.');
  }
  const rows = value.rows.map((row) => Object.fromEntries(ASSAY_CONTEXT_COLUMNS.map((column) => {
    const cell = row?.[column] ?? '';
    if (!['string', 'number', 'boolean'].includes(typeof cell)
      || (typeof cell === 'number' && !Number.isFinite(cell))
      || String(cell).length > 4000) {
      throw new Error(`Invalid active plate cell in ${column}.`);
    }
    return [column, cell];
  })));
  return { columns: [...ASSAY_CONTEXT_COLUMNS], rows, row_count: rows.length };
}
