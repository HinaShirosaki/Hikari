import { escapeCsv } from '../assay/shared.js';
import { createDefaultWells, isMultiWellContainer } from '../personal-inventory/constants.js';
import { buildLocationFromInventoryLink } from './inventory-links.js';

// Flat sample columns + container placement, so a whole box round-trips.
// ponytail: chemical structure / chemical links are still not round-tripped.
export const CSV_COLUMNS = [
  'code', 'name', 'type', 'lot', 'concentration', 'notes',
  'section', 'container', 'container_type', 'well'
];

const CONTAINER_TYPES = new Set(['single', 'box81', 'plate96', 'customGrid']);

export function toSamplesCsv(samples, inventory = {}) {
  const rows = (samples || []).map((sample) => {
    const placement = describePlacement(sample?.inventoryLink, inventory);
    const values = {
      code: sample?.code,
      name: sample?.name,
      type: sample?.type,
      lot: sample?.lot,
      concentration: sample?.concentration,
      notes: sample?.notes,
      ...placement
    };
    return CSV_COLUMNS.map((key) => escapeCsv(values[key])).join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

function describePlacement(link, inventory) {
  const empty = { section: '', container: '', container_type: '', well: '' };
  if (!link || !link.section || !link.containerId) {
    return empty;
  }
  const container = (inventory?.[link.section] || []).find((item) => item.id === link.containerId);
  if (!container) {
    return empty;
  }
  return {
    section: link.section,
    container: container.name || '',
    container_type: container.type || 'box81',
    well: link.wellIndex === null || link.wellIndex === undefined ? '' : String(Number(link.wellIndex) + 1)
  };
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

function findContainer(list, name) {
  const target = String(name || '').trim().toLowerCase();
  return (Array.isArray(list) ? list : []).find((item) => String(item.name || '').trim().toLowerCase() === target) || null;
}

function ensureContainer(state, section, name, type, makeId) {
  if (!state.inventory || typeof state.inventory !== 'object') {
    state.inventory = {};
  }
  if (!Array.isArray(state.inventory[section])) {
    state.inventory[section] = [];
  }
  let container = findContainer(state.inventory[section], name);
  if (!container) {
    const safeType = CONTAINER_TYPES.has(type) ? type : 'box81';
    container = {
      id: `container-${makeId()}`,
      name: String(name).trim(),
      type: safeType,
      wells: createDefaultWells({ type: safeType }),
      singleContent: safeType === 'single' ? '' : undefined
    };
    state.inventory[section].push(container);
  }
  return container;
}

// Mutates record.inventoryLink/location in place when the row names a container.
function applyContainerPlacement(state, row, record, makeId) {
  const section = String(row.section || '').trim();
  const containerName = String(row.container || '').trim();
  if (!section || !containerName) {
    return; // ponytail: blank container columns leave any existing link untouched (no unlink-via-CSV).
  }
  const container = ensureContainer(state, section, containerName, String(row.container_type || '').trim().toLowerCase(), makeId);
  let wellIndex = null;
  const wellRaw = String(row.well || '').trim();
  if (wellRaw && isMultiWellContainer(container)) {
    const slot = Number(wellRaw);
    // ponytail: out-of-range slots link to the container without a well rather than resize the box.
    if (Number.isInteger(slot) && slot >= 1 && slot <= (container.wells?.length || 0)) {
      wellIndex = slot - 1;
    }
  }
  record.inventoryLink = { section, containerId: container.id, wellIndex };
  record.location = buildLocationFromInventoryLink(
    { section, containerId: container.id, container },
    wellIndex === null ? '' : wellIndex
  ) || record.location || {};
}

// Upsert parsed rows into state.samples by code, placing each into its container. Mutates state; caller persists.
export function mergeSamplesFromCsv(state, rows, makeId = defaultMakeId) {
  if (!Array.isArray(state.samples)) {
    state.samples = [];
  }
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
    const index = state.samples.findIndex((item) => item.code === code);
    const base = index >= 0 ? state.samples[index] : {
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
    applyContainerPlacement(state, row, record, makeId);
    if (index >= 0) {
      state.samples[index] = record;
      updated += 1;
    } else {
      state.samples.push(record);
      created += 1;
    }
  }
  return { created, updated };
}
