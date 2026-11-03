import { escapeCsv } from '../../lib/csv.js';
import { getPlateDefinition, toRowLabel, wellIdFor } from './plate-model.js';
import { applyPlateTransform, isTransformActive } from './derived-plate.js';

// Keep full plate coordinates, including empty/hidden rows. These files are
// independent snapshots of Table1 and the calculated values shown in Table2.
export function buildAssayPlateCsvFiles(assay) {
  const definition = getPlateDefinition(assay.plateType || '96');
  const original = assay.resultValues || {};
  let transformed = {};
  if (isTransformActive(assay.transformSpec)) {
    const derived = applyPlateTransform({
      results: original,
      spec: assay.transformSpec,
      definition,
      rowGroupSpec: String(assay.analysisGroups?.row || ''),
      columnGroupSpec: String(assay.analysisGroups?.column || '')
    });
    transformed = { ...derived.results };
    for (const [well, cell] of Object.entries(derived.cells || {})) {
      if (cell.error) transformed[well] = '#ERROR';
    }
    if (derived.formulaError) {
      for (const well of Object.keys(original)) transformed[well] = '#ERROR';
    }
  }
  function matrixCsv(values) {
    const rows = [['', ...Array.from({ length: definition.columns }, (_, index) => index + 1)]];
    for (let row = 0; row < definition.rows; row++) {
      rows.push([toRowLabel(row), ...Array.from({ length: definition.columns }, (_, column) => values[wellIdFor(row, column)] ?? '')]);
    }
    return `${rows.map(row => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`;
  }
  return {
    original: { fileName: 'original-plate.csv', name: 'Original plate (CSV)', content: matrixCsv(original) },
    transformed: { fileName: 'transformed-plate.csv', name: 'Transformed plate (CSV)', content: matrixCsv(transformed) }
  };
}
