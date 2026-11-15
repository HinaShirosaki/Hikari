import { PLATE_DEFINITIONS } from './constants.js';
import { toRowLabel } from '../../lib/plate-wells.js';
import { AXIS_FIELDS, getAssayAxisFields, getFieldAxis, hasWellValues, readConditionValues } from './axis-fields.js';

export { toRowLabel };

export function getPlateDefinition(value) {
  return PLATE_DEFINITIONS.find((item) => item.value === String(value || '')) || PLATE_DEFINITIONS[0];
}

export function wellIdFor(rowIndex, columnIndex) {
  return `${toRowLabel(rowIndex)}${columnIndex + 1}`;
}

export function rowLabelToIndex(label) {
  const value = String(label || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(value)) {
    return -1;
  }
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total * 26) + (value.charCodeAt(index) - 64);
  }
  return total - 1;
}

export function parseWellId(wellId) {
  const normalized = String(wellId || '').trim().toUpperCase();
  const match = normalized.match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    return null;
  }
  const rowIndex = rowLabelToIndex(match[1]);
  const columnIndex = Number(match[2]) - 1;
  if (rowIndex < 0 || !Number.isFinite(columnIndex) || columnIndex < 0) {
    return null;
  }
  return {
    well: normalized,
    rowIndex,
    columnIndex
  };
}

export function buildAllWells(def) {
  const wells = [];
  for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
      wells.push({
        well: wellIdFor(rowIndex, columnIndex),
        row: toRowLabel(rowIndex),
        column: columnIndex + 1
      });
    }
  }
  return wells;
}

// Plate layout = sparse list of { well: 'B7', sampleId, concentration };
// empty wells and wells outside the plate definition are dropped. Results are a
// separate { [well]: rawValueString } map, also keyed by upper-case well id.
export function normalizeLayout(layout, def) {
  const validIds = new Set(buildAllWells(def).map((item) => item.well));
  return (Array.isArray(layout) ? layout : [])
    .map((item) => ({
      well: String(item?.well || '').trim().toUpperCase(),
      sampleId: String(item?.sampleId || '').trim(),
      concentration: String(item?.concentration || '').trim(),
      ...readConditionValues(item)
    }))
    .filter((item) => validIds.has(item.well) && hasWellValues(item));
}

export function layoutToMap(layout) {
  const map = {};
  (layout || []).forEach((item) => {
    const well = String(item?.well || '').trim().toUpperCase();
    if (!well) {
      return;
    }
    map[well] = {
      sampleId: String(item.sampleId || ''),
      concentration: String(item.concentration || ''),
      ...readConditionValues(item)
    };
  });
  return map;
}

export function buildMappedWellSet(layout) {
  return new Set((layout || []).map((item) => String(item.well || '').trim().toUpperCase()).filter(Boolean));
}

// Only wells with a layout entry carry analysable results; readings from
// unmapped wells (blanks the user never labelled) are ignored.
export function filterResultsToMappedWells(results, layout) {
  const mapped = buildMappedWellSet(layout);
  if (!mapped.size) {
    return {};
  }
  const filtered = {};
  Object.entries(results || {}).forEach(([well, value]) => {
    const normalizedWell = String(well || '').trim().toUpperCase();
    if (!mapped.has(normalizedWell)) {
      return;
    }
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue) {
      return;
    }
    filtered[normalizedWell] = normalizedValue;
  });
  return filtered;
}

export function normalizeResults(results, def) {
  const validIds = new Set(buildAllWells(def).map((item) => item.well));
  const normalized = {};

  if (Array.isArray(results)) {
    results.forEach((item) => {
      const well = String(item?.well || '').trim().toUpperCase();
      const value = String(item?.value ?? '').trim();
      if (!value || !validIds.has(well)) {
        return;
      }
      normalized[well] = value;
    });
    return normalized;
  }

  if (!results || typeof results !== 'object') {
    return normalized;
  }

  Object.entries(results).forEach(([well, value]) => {
    const normalizedWell = String(well || '').trim().toUpperCase();
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue || !validIds.has(normalizedWell)) {
      return;
    }
    normalized[normalizedWell] = normalizedValue;
  });

  return normalized;
}

export function isValidWellForDefinition(wellId, def) {
  const parsed = parseWellId(wellId);
  if (!parsed) {
    return false;
  }
  return parsed.rowIndex < def.rows && parsed.columnIndex < def.columns;
}

export function sortLayout(layout) {
  return (layout || []).slice().sort((a, b) => {
    const pa = parseWellId(a.well);
    const pb = parseWellId(b.well);
    if (!pa && !pb) {
      return String(a.well).localeCompare(String(b.well));
    }
    if (!pa) {
      return 1;
    }
    if (!pb) {
      return -1;
    }
    if (pa.rowIndex !== pb.rowIndex) {
      return pa.rowIndex - pb.rowIndex;
    }
    return pa.columnIndex - pb.columnIndex;
  });
}

export function getAxisLength(axis, def) {
  return axis === 'column' ? def.columns : def.rows;
}

export function normalizeCurrentAxisTemplateValues(values, def, fields) {
  return mergeAxisTemplateValues({ def, fields, sources: [values] });
}

export function hasAxisTemplateValues(values) {
  return (Array.isArray(values) ? values : []).some((item) => String(item || '').trim());
}

export function mergeAxisTemplateValues({ def, fields, sources }) {
  const merged = { sampleValues: [], concentrationValues: [] };
  for (const [field, { valuesKey }] of Object.entries(AXIS_FIELDS)) {
    const axis = getFieldAxis(fields, field);
    const maxLength = Math.max(def.rows, def.columns);
    const sourceArrays = sources.map(source => source?.[valuesKey]).filter(Array.isArray);
    const assignedLength = axis ? getAxisLength(axis, def) : 0;
    const length = sourceArrays.reduce((size, entries) =>
      Math.max(size, entries.slice(0, maxLength).findLastIndex(value => String(value ?? '').trim()) + 1), assignedLength);
    if (!length) continue;
    const values = new Array(length).fill('');
    for (const entries of sourceArrays) {
      for (let index = 0; index < Math.min(entries.length, length); index += 1) {
        if (entries[index] !== undefined) values[index] = String(entries[index] ?? '').trim();
      }
    }
    merged[valuesKey] = values;
  }
  return merged;
}

// Per-well edits made on top of the axis template, kept separately so a
// template change does not wipe them.
export function normalizeManualWellOverrideMap(source, def) {
  const normalized = {};
  Object.entries(source || {}).forEach(([well, value]) => {
    const normalizedWell = String(well || '').trim().toUpperCase();
    if (!normalizedWell || !isValidWellForDefinition(normalizedWell, def)) {
      return;
    }
    const fields = readConditionValues(value, { keepEmpty: true });
    for (const field of ['sampleId', 'concentration']) {
      if (Object.hasOwn(value || {}, field)) fields[field] = String(value[field] ?? '').trim();
    }
    if (Object.keys(fields).length) normalized[normalizedWell] = fields;
  });
  return normalized;
}

export function applyAxisTemplate({ def, fields, values, mappingMode = 'auto' }) {
  const rowField = AXIS_FIELDS[fields.row];
  const columnField = AXIS_FIELDS[fields.column];
  const rowValues = values[rowField.valuesKey];
  const columnValues = values[columnField.valuesKey];
  const requireIntersection = mappingMode !== 'union'
    && hasAxisTemplateValues(rowValues.slice(0, def.rows))
    && hasAxisTemplateValues(columnValues.slice(0, def.columns));
  const layout = [];
  for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
      const rowValue = rowValues[rowIndex] || '';
      const columnValue = columnValues[columnIndex] || '';
      if (requireIntersection ? !(rowValue && columnValue) : !(rowValue || columnValue)) continue;
      const well = { well: wellIdFor(rowIndex, columnIndex), sampleId: '', concentration: '' };
      if (rowValue) well[rowField.wellKey] = rowValue;
      if (columnValue) well[columnField.wellKey] = columnValue;
      layout.push(well);
    }
  }
  return layout;
}

export function layoutsEqual(left, right, def) {
  const leftMap = layoutToMap(normalizeLayout(left, def));
  const rightMap = layoutToMap(normalizeLayout(right, def));
  const keys = new Set([
    ...Object.keys(leftMap),
    ...Object.keys(rightMap)
  ]);

  for (const key of keys) {
    if (Object.values(AXIS_FIELDS).some(({ wellKey }) =>
      (leftMap[key]?.[wellKey] || '') !== (rightMap[key]?.[wellKey] || ''))) {
      return false;
    }
  }
  return true;
}

export function removeSuppressedWellsFromLayout(layout, def, suppressed) {
  const map = layoutToMap(normalizeLayout(layout, def));
  Array.from(suppressed || []).forEach((well) => {
    delete map[String(well || '').trim().toUpperCase()];
  });
  return normalizeLayout(Object.entries(map).map(([well, value]) => ({
    well,
    ...value
  })), def);
}

export function getAssayAxisTemplateValues(assay, def) {
  return normalizeCurrentAxisTemplateValues({
    ...assay?.conditionAxisValues,
    sampleValues: assay?.sampleAxisValues,
    concentrationValues: assay?.concentrationAxisValues
  }, def, getAssayAxisFields(assay));
}
