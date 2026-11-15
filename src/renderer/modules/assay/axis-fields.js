import { oppositeAxis } from './shared.js';

export const AXIS_FIELDS = Object.freeze({
  sample: { wellKey: 'sampleId', valuesKey: 'sampleValues', label: 'field.sampleId' },
  concentration: { wellKey: 'concentration', valuesKey: 'concentrationValues', label: 'field.concentration' },
  temperature: { wellKey: 'temperature', valuesKey: 'temperatureValues', label: 'field.temperature' },
  time: { wellKey: 'time', valuesKey: 'timeValues', label: 'field.time' },
  ph: { wellKey: 'ph', valuesKey: 'phValues', label: 'field.ph' },
  treatment: { wellKey: 'treatment', valuesKey: 'treatmentValues', label: 'field.treatment' }
});

export const CONDITION_FIELDS = ['temperature', 'time', 'ph', 'treatment'];

export function getAssayAxisFields(assay) {
  const { row, column } = assay?.axisFields || {};
  if (row !== column && Object.hasOwn(AXIS_FIELDS, row) && Object.hasOwn(AXIS_FIELDS, column)) {
    return { row, column };
  }
  return assay?.sampleAxis === 'column'
    ? { row: 'concentration', column: 'sample' }
    : { row: 'sample', column: 'concentration' };
}

export function getFieldAxis(fields, field) {
  if (fields.row === field) return 'row';
  if (fields.column === field) return 'column';
  return '';
}

// Existing sample/concentration consumers use this orientation as a fallback
// when one or both fields are entered directly in wells.
export function getSampleAxisOrientation(fields) {
  return getFieldAxis(fields, 'sample') || oppositeAxis(getFieldAxis(fields, 'concentration') || 'column');
}

export function getVisibleConditionFields(fields, layout) {
  return CONDITION_FIELDS.filter(field => fields.row === field || fields.column === field
    || layout.some(well => well[field]));
}

export function getConditionAxisValues(axisValues) {
  return Object.fromEntries(CONDITION_FIELDS.map(field => AXIS_FIELDS[field].valuesKey)
    .filter(key => axisValues[key]).map(key => [key, axisValues[key]]));
}

export function hasWellValues(well) {
  return Boolean(well?.sampleId || well?.concentration || CONDITION_FIELDS.some(field => well?.[field]));
}

export function readConditionValues(well, { keepEmpty = false } = {}) {
  const values = {};
  for (const field of CONDITION_FIELDS) {
    if (!Object.hasOwn(well || {}, field)) continue;
    const value = String(well[field] ?? '').trim();
    if (value || keepEmpty) values[field] = value;
  }
  return values;
}
