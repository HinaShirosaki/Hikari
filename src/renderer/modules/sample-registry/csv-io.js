import { escapeCsv } from '../assay/shared.js';

// ponytail: flat, human-editable columns only — location/links/structure/passage are not round-tripped.
export const CSV_COLUMNS = ['code', 'name', 'type', 'lot', 'concentration', 'notes'];

export function toSamplesCsv(samples) {
  const rows = (samples || []).map((sample) =>
    CSV_COLUMNS.map((key) => escapeCsv(sample?.[key])).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

// Full-text parser so quoted commas / newlines inside notes survive (mirrors lab-common-inventory parseCsvRows).
function parseCsvCells(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && source[index + 1] === '\n') {
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
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

export function parseSamplesCsv(text) {
  const rows = parseCsvCells(text);
  if (rows.length < 2) {
    return [];
  }
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  return rows.slice(1)
    .map((cells) => {
      const row = {};
      header.forEach((key, index) => {
        if (CSV_COLUMNS.includes(key)) {
          row[key] = String(cells[index] || '').trim();
        }
      });
      return row;
    })
    .filter((row) => row.name);
}

function normalizeCsvCode(value) {
  return String(value || '').trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
}

let idCounter = 0;
function defaultMakeId() {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// Upsert parsed rows into the existing samples by code. Pure — caller persists/re-renders.
export function mergeSamplesFromCsv(existing, rows, makeId = defaultMakeId) {
  const samples = Array.isArray(existing) ? existing.slice() : [];
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (!name) {
      continue;
    }
    const code = normalizeCsvCode(row.code) || `S-${makeId()}`;
    // ponytail: keep whatever type string is given (formatted); display-time normalizeSampleType maps unknowns.
    const type = String(row.type || '').trim().toLowerCase().replace(/\s+/g, '_') || 'plasmid';
    const index = samples.findIndex((item) => item.code === code);
    const base = index >= 0 ? samples[index] : {
      id: `sample-${makeId()}`,
      location: {},
      inventoryLink: null,
      chemicalLinks: [],
      compoundStructure: null,
      cellPassage: null
    };
    const record = {
      ...base,
      code,
      name,
      type,
      lot: String(row.lot || '').trim(),
      concentration: String(row.concentration || '').trim(),
      notes: String(row.notes || '').trim(),
      updatedAt: new Date().toISOString()
    };
    if (index >= 0) {
      samples[index] = record;
      updated += 1;
    } else {
      samples.push(record);
      created += 1;
    }
  }
  return { samples, created, updated };
}
