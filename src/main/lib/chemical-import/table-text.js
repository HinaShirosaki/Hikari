'use strict';

function trimTrailingEmptyCells(row) {
  const next = Array.isArray(row) ? [...row] : [];
  while (next.length && !String(next[next.length - 1] ?? '').trim()) {
    next.pop();
  }
  return next;
}

function normalizeTableRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => trimTrailingEmptyCells(row.map((cell) => String(cell ?? '').trim())))
    .filter((row) => row.some((cell) => String(cell || '').trim()));
}

function buildParsedTable(rows, metadata = {}) {
  const normalizedRows = normalizeTableRows(rows);
  const headers = normalizedRows[0] || [];
  const dataRows = normalizedRows.slice(1);
  return {
    headers,
    rows: dataRows,
    tableRows: normalizedRows,
    rowCount: dataRows.length,
    ...metadata
  };
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)));
}

function decodeZipName(buffer) {
  return buffer.toString('utf8');
}

function parseDelimitedText(rawText, delimiter = '') {
  const text = String(rawText || '').replace(/^\uFEFF/, '');
  const sample = text.slice(0, 4096);
  const resolvedDelimiter = delimiter || [
    { value: ',', count: (sample.match(/,/g) || []).length },
    { value: '\t', count: (sample.match(/\t/g) || []).length },
    { value: ';', count: (sample.match(/;/g) || []).length }
  ].sort((a, b) => b.count - a.count)[0]?.value || ',';
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === resolvedDelimiter && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return buildParsedTable(rows, {
    format: resolvedDelimiter === '\t' ? 'tsv' : 'csv'
  });
}

module.exports = {
  buildParsedTable,
  decodeXmlEntities,
  decodeZipName,
  normalizeTableRows,
  parseDelimitedText
};
