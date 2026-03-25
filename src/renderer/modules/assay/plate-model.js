import { PLATE_DEFINITIONS } from './constants.js';
import { oppositeAxis } from './shared.js';

export function getPlateDefinition(value) {
  return PLATE_DEFINITIONS.find((item) => item.value === String(value || '')) || PLATE_DEFINITIONS[0];
}

export function toRowLabel(rowIndex) {
  let value = Number(rowIndex) + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
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

export function normalizeLayout(layout, def) {
  const validIds = new Set(buildAllWells(def).map((item) => item.well));
  return (Array.isArray(layout) ? layout : [])
    .map((item) => ({
      well: String(item?.well || '').trim().toUpperCase(),
      sampleId: String(item?.sampleId || '').trim(),
      concentration: String(item?.concentration || '').trim()
    }))
    .filter((item) => validIds.has(item.well) && (item.sampleId || item.concentration));
}

export function layoutToMap(layout) {
  const map = {};
  (layout || []).forEach((item) => {
    if (!item?.well) {
      return;
    }
    map[item.well] = {
      sampleId: String(item.sampleId || ''),
      concentration: String(item.concentration || '')
    };
  });
  return map;
}

export function buildMappedWellSet(layout) {
  return new Set((layout || []).map((item) => String(item.well || '').trim().toUpperCase()).filter(Boolean));
}

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

export function normalizeAxisTemplateValues(values, maxLength) {
  return (Array.isArray(values) ? values : [])
    .map((item) => String(item || '').trim())
    .slice(0, maxLength);
}

export function normalizeCurrentAxisTemplateValues(values, def, sampleAxis) {
  return {
    sampleValues: normalizeAxisTemplateValues(values?.sampleValues, getAxisLength(sampleAxis, def)),
    concentrationValues: normalizeAxisTemplateValues(values?.concentrationValues, getAxisLength(oppositeAxis(sampleAxis), def))
  };
}

export function hasAxisTemplateValues(values) {
  return (Array.isArray(values) ? values : []).some((item) => String(item || '').trim());
}

export function mergeAxisTemplateValues({ def, sampleAxis, sources }) {
  const sampleLength = getAxisLength(sampleAxis, def);
  const concentrationLength = getAxisLength(oppositeAxis(sampleAxis), def);
  const merged = {
    sampleValues: new Array(sampleLength).fill(''),
    concentrationValues: new Array(concentrationLength).fill('')
  };

  (Array.isArray(sources) ? sources : []).filter(Boolean).forEach((source) => {
    if (Array.isArray(source.sampleValues)) {
      for (let index = 0; index < Math.min(source.sampleValues.length, sampleLength); index += 1) {
        merged.sampleValues[index] = String(source.sampleValues[index] || '').trim();
      }
    }
    if (Array.isArray(source.concentrationValues)) {
      for (let index = 0; index < Math.min(source.concentrationValues.length, concentrationLength); index += 1) {
        merged.concentrationValues[index] = String(source.concentrationValues[index] || '').trim();
      }
    }
  });

  return merged;
}

export function normalizeManualWellOverrideMap(source, def) {
  const normalized = {};
  Object.entries(source || {}).forEach(([well, value]) => {
    const normalizedWell = String(well || '').trim().toUpperCase();
    if (!normalizedWell || !isValidWellForDefinition(normalizedWell, def)) {
      return;
    }
    const sampleId = String(value?.sampleId || '').trim();
    const concentration = String(value?.concentration || '').trim();
    if (!sampleId && !concentration) {
      return;
    }
    normalized[normalizedWell] = { sampleId, concentration };
  });
  return normalized;
}

export function applyAxisTemplate({
  def,
  sampleAxis,
  sampleValues,
  concentrationValues,
  mappingMode = 'auto'
}) {
  const requireIntersection = mappingMode === 'union'
    ? false
    : hasAxisTemplateValues(sampleValues) && hasAxisTemplateValues(concentrationValues);
  const layout = [];
  for (let rowIndex = 0; rowIndex < def.rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < def.columns; columnIndex += 1) {
      const sampleId = sampleAxis === 'row'
        ? (sampleValues[rowIndex] || '')
        : (sampleValues[columnIndex] || '');
      const concentration = sampleAxis === 'row'
        ? (concentrationValues[columnIndex] || '')
        : (concentrationValues[rowIndex] || '');
      if (requireIntersection) {
        if (!sampleId || !concentration) {
          continue;
        }
      } else if (!sampleId && !concentration) {
        continue;
      }
      layout.push({
        well: wellIdFor(rowIndex, columnIndex),
        sampleId,
        concentration
      });
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
    const leftValue = leftMap[key] || { sampleId: '', concentration: '' };
    const rightValue = rightMap[key] || { sampleId: '', concentration: '' };
    if (String(leftValue.sampleId || '').trim() !== String(rightValue.sampleId || '').trim()
      || String(leftValue.concentration || '').trim() !== String(rightValue.concentration || '').trim()) {
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
    sampleId: value.sampleId,
    concentration: value.concentration
  })), def);
}

export function getAssayAxisTemplateValues(assay, def) {
  const sampleAxis = assay?.sampleAxis === 'column' ? 'column' : 'row';
  return normalizeCurrentAxisTemplateValues({
    sampleValues: assay?.sampleAxisValues,
    concentrationValues: assay?.concentrationAxisValues
  }, def, sampleAxis);
}
