export function oppositeAxis(axis) {
  return axis === 'column' ? 'row' : 'column';
}

export function axisLabel(axis) {
  return axis === 'column' ? 'Column' : 'Row';
}

export function formatTimestamp(raw) {
  const value = Date.parse(String(raw || ''));
  return Number.isFinite(value) ? new Date(value).toLocaleString() : '-';
}

export function notebookLabel(entry) {
  const type = entry.notebookType === 'biology' ? 'Biology' : 'Synthesis';
  return `${type}: ${entry.protocolName || '-'} (${formatTimestamp(entry.updatedAt)})`;
}

export function sanitizeFilePart(text, fallback) {
  const cleaned = String(text || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function escapeCsv(value) {
  const text = String(value || '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

export function parseNumericResult(value) {
  const normalized = String(value || '').trim().replace(/,/g, '');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseFirstNumericToken(value) {
  const normalized = String(value || '').trim().replace(/,/g, '');
  const match = normalized.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}
