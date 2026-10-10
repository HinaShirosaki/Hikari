import { escapeCsv } from '../../lib/csv.js';
import { getContainerWellName } from '../../lib/inventory-containers.js';
import { buildSampleLocation, normalizeSampleCode } from '../../lib/sample-records.js';
import { DETAIL_KEYS, normalizeSampleDetails } from './type-fields.js';

// One grid container per file. The well label (W5, A1, or the well's own
// name) places each row, so a box round-trips; empty wells export as blank
// rows to fill in.
// ponytail: chemical structure / chemical links are still not round-tripped.
export const CSV_COLUMNS = [
  'well', 'code', 'name', 'type', 'lot', 'concentration', 'notes',
  ...DETAIL_KEYS
];

function isInContainer(sample, section, container) {
  const link = sample?.inventoryLink;
  return link?.section === section && link?.containerId === container.id;
}

export function containerToCsv(samples, section, container) {
  const placed = (samples || []).filter((sample) => isInContainer(sample, section, container));
  const rows = (container.wells || []).flatMap((_well, index) => {
    const well = getContainerWellName(container, index);
    const inWell = placed.filter((sample) => Number(sample.inventoryLink.wellIndex) === index);
    return (inWell.length ? inWell : [{}]).map((sample) => {
      const values = {
        well,
        code: sample.code,
        name: sample.name,
        type: sample.type,
        lot: sample.lot,
        concentration: sample.concentration,
        notes: sample.notes,
        ...sample.details
      };
      return CSV_COLUMNS.map((key) => escapeCsv(values[key])).join(',');
    });
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

// Full-text parser so quoted commas / newlines inside notes survive (mirrors lab-common-inventory parseCsvRows).
function parseCsvCells(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = String(text || '').replace(/^﻿/, '');
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

// Rows keyed by known column; rows without a name (empty wells) are dropped.
// Throws when the header has no well column, since nothing could be placed.
export function parseContainerCsv(text) {
  const rows = parseCsvCells(text);
  if (rows.length < 2) {
    return [];
  }
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  if (!header.includes('well')) {
    throw new Error('Import CSV needs a "well" column.');
  }
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

let idCounter = 0;
function defaultMakeId() {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// Upserts rows into state.samples by code and places each in its well of this
// container (a code that already exists elsewhere moves here). Rows whose well
// label matches no well are skipped. Mutates state; caller persists.
export function mergeContainerCsv(state, section, container, rows, makeId = defaultMakeId) {
  if (!Array.isArray(state.samples)) {
    state.samples = [];
  }
  const wellIndexByLabel = new Map((container.wells || []).map((_well, index) => [
    getContainerWellName(container, index).toLowerCase(),
    index
  ]));
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const recoded = [];
  const rawCodeByCode = new Map();
  const codeByRawCode = new Map();
  for (const row of rows) {
    const name = String(row.name || '').trim();
    const wellIndex = wellIndexByLabel.get(String(row.well || '').trim().toLowerCase());
    if (!name || wellIndex === undefined) {
      skipped += 1;
      continue;
    }
    const rawCode = String(row.code || '').trim();
    let code = codeByRawCode.get(rawCode) || normalizeSampleCode(rawCode) || `S-${makeId()}`;
    // Codes keep only [A-Za-z0-9._-], so two different codes in one file can
    // reduce to the same one ("α-1" and "β-1"). The later row gets its own code
    // rather than overwriting the sample the earlier row wrote.
    if (rawCodeByCode.has(code) && rawCodeByCode.get(code) !== rawCode) {
      let suffix = 2;
      while (rawCodeByCode.has(`${code}-${suffix}`)) {
        suffix += 1;
      }
      recoded.push({ from: rawCode, to: `${code}-${suffix}` });
      code = `${code}-${suffix}`;
    }
    rawCodeByCode.set(code, rawCode);
    if (rawCode) {
      codeByRawCode.set(rawCode, code);
    }
    const index = state.samples.findIndex((item) => item.code === code);
    const base = index >= 0 ? state.samples[index] : {
      id: `sample-${makeId()}`,
      chemicalLinks: [],
      compoundStructure: null,
      cellPassage: null
    };
    // Columns absent from the CSV keep their stored value; present ones win,
    // and a present-but-blank cell clears. A blank type keeps the stored one:
    // falling back to plasmid would drop every field of the real type.
    const column = (key) => (key in row ? String(row[key] || '').trim() : String(base[key] || ''));
    // ponytail: keep whatever type string is given (formatted); display-time normalizeSampleType maps unknowns.
    const type = String(row.type || '').trim().toLowerCase().replace(/\s+/g, '_') || base.type || 'plasmid';
    const record = {
      ...base,
      code,
      name,
      type,
      lot: column('lot'),
      concentration: column('concentration'),
      notes: column('notes'),
      details: normalizeSampleDetails(type, { ...base.details, ...row }),
      inventoryLink: { section, containerId: container.id, wellIndex },
      location: buildSampleLocation(section, container, wellIndex),
      updatedAt: new Date().toISOString()
    };
    if (index >= 0) {
      state.samples[index] = record;
      updated += 1;
    } else {
      state.samples.push(record);
      created += 1;
    }
  }
  return { created, updated, skipped, recoded };
}
