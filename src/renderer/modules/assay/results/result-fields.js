// Result-grid column fields are stored as c1..cN; these convert between that
// wire name and the zero-based column index.
function toResultField(columnIndex) {
  return `c${columnIndex + 1}`;
}

function resultFieldToColumnIndex(field) {
  const parsed = Number(String(field || '').replace(/^c/, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return -1;
  }
  return parsed - 1;
}

export { toResultField, resultFieldToColumnIndex };
