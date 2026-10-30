import { isValidWellForDefinition, parseWellId, wellIdFor } from '../plate-model.js';
import { parseNumericResult } from '../shared.js';
import { resolveReferenceWells } from './reference-wells.js';

function referenceMean(reference, numericResults, def, groupSpecs, warnings, label) {
  const { wells, unresolved } = resolveReferenceWells(reference, def, groupSpecs);
  if (unresolved.length) {
    warnings.push(`${label}: could not resolve ${unresolved.join(', ')}.`);
  }
  const values = wells
    .map((well) => numericResults[well])
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    warnings.push(`${label}: no numeric values in "${reference}".`);
    return null;
  }
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    n: values.length
  };
}

function formatValue(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 0.001 || absolute >= 100000)) {
    return value.toExponential(3);
  }
  return String(Math.round(value * 10000) / 10000);
}

function applyValueTransform(value, transform) {
  switch (transform) {
    case 'log10': return value > 0 ? Math.log10(value) : null;
    case 'ln': return value > 0 ? Math.log(value) : null;
    case 'sqrt': return value >= 0 ? Math.sqrt(value) : null;
    case 'reciprocal': return value !== 0 ? 1 / value : null;
    case 'square': return value ** 2;
    default: return value;
  }
}

function readNumericPlate(results, def) {
  const numeric = {};
  Object.entries(results || {}).forEach(([well, raw]) => {
    const value = parseNumericResult(raw);
    if (Number.isFinite(value) && isValidWellForDefinition(well, def)) {
      numeric[well] = value;
    }
  });
  return numeric;
}

// The rectangular block between two wells, Excel style.
function blockWells(fromWell, toWell, def) {
  const from = parseWellId(String(fromWell).toUpperCase());
  const to = parseWellId(String(toWell).toUpperCase());
  if (!from || !to) {
    return null;
  }
  const wells = [];
  for (let row = Math.min(from.rowIndex, to.rowIndex); row <= Math.max(from.rowIndex, to.rowIndex); row += 1) {
    for (let col = Math.min(from.columnIndex, to.columnIndex); col <= Math.max(from.columnIndex, to.columnIndex); col += 1) {
      const well = wellIdFor(row, col);
      if (isValidWellForDefinition(well, def)) {
        wells.push(well);
      }
    }
  }
  return wells.length ? wells : null;
}

function collectReferenceNodes(node, found = []) {
  if (!node || typeof node !== 'object') {
    return found;
  }
  if (node.kind === 'ref' || node.kind === 'range') {
    found.push(node);
  }
  [node.left, node.right, node.arg, ...(node.args || [])].forEach((child) => {
    if (child) {
      collectReferenceNodes(child, found);
    }
  });
  return found;
}

function referenceTable(node) {
  return String(node?.table || 'Table1').trim().toLowerCase();
}

function referenceNodeLabel(node) {
  const prefix = node?.table ? `${node.table}:` : '';
  return node?.kind === 'range'
    ? `${prefix}${node.from}:${node.to}`
    : `${prefix}${node.name}`;
}

function describeFormulaError(error) {
  const at = Number.isInteger(error?.position) ? ` (position ${error.position + 1})` : '';
  return `Formula error: ${error?.message || 'could not be parsed.'}${at}`;
}

// Evaluates one formula per well. References are resolved once, up front, against the

export {
  applyValueTransform,
  blockWells,
  collectReferenceNodes,
  describeFormulaError,
  formatValue,
  readNumericPlate,
  referenceMean,
  referenceNodeLabel,
  referenceTable
};
