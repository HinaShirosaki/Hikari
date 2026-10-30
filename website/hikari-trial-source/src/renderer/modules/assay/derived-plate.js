import { buildAllWells, toRowLabel, wellIdFor } from './plate-model.js';
import { parseDimensionGroupSpec } from './analysis/shared.js';
import { applyPlateCellFormulas, applyPlateFormula } from './derived-plate/plate-formulas.js';
import { applyValueTransform, formatValue, readNumericPlate, referenceMean } from './derived-plate/plate-values.js';
import { ARITHMETIC_LABELS, TRANSFORM_LABELS, normalizeTransformSpec } from './derived-plate/transform-spec.js';

// Returns the derived results map plus a plain-language description of each step, so
// the panel can say exactly what was done to the numbers being analysed.
export function applyPlateTransform({
  results = {},
  spec,
  definition,
  rowGroupSpec = '',
  columnGroupSpec = ''
} = {}) {
  const normalized = normalizeTransformSpec(spec);
  const def = definition;

  if (normalized.mode === 'cells') {
    return applyPlateCellFormulas({
      results,
      formulas: normalized.formulas,
      definition: def,
      rowGroupSpec,
      columnGroupSpec
    });
  }

  if (normalized.mode === 'formula') {
    return applyPlateFormula({
      results,
      formula: normalized.formula,
      definition: def,
      rowGroupSpec,
      columnGroupSpec
    });
  }

  const warnings = [];
  const steps = [];
  const numeric = readNumericPlate(results, def);

  const groupSpecs = {
    row: parseDimensionGroupSpec(rowGroupSpec, 'row', def.rows),
    column: parseDimensionGroupSpec(columnGroupSpec, 'column', def.columns)
  };

  let current = { ...numeric };

  if (normalized.blank) {
    const blank = referenceMean(normalized.blank, current, def, groupSpecs, warnings, 'Blank');
    if (blank) {
      Object.keys(current).forEach((well) => {
        current[well] -= blank.mean;
      });
      steps.push(`Subtracted blank "${normalized.blank}" (mean ${formatValue(blank.mean)}, n=${blank.n}).`);
    }
  }

  if (!normalized.normalizeHundred && normalized.normalizeZero) {
    warnings.push('Normalisation skipped: a 0% reference also needs a 100% reference.');
  }

  if (normalized.normalizeHundred) {
    const hundred = referenceMean(normalized.normalizeHundred, current, def, groupSpecs, warnings, '100%');
    const zero = normalized.normalizeZero
      ? referenceMean(normalized.normalizeZero, current, def, groupSpecs, warnings, '0%')
      : { mean: 0, n: 0 };
    if (hundred && zero) {
      const span = hundred.mean - zero.mean;
      if (span === 0) {
        warnings.push('Normalisation skipped: the 0% and 100% references have the same mean.');
      } else {
        Object.keys(current).forEach((well) => {
          current[well] = ((current[well] - zero.mean) / span) * 100;
        });
        steps.push(
          `Normalised to "${normalized.normalizeHundred}" = 100%`
          + `${normalized.normalizeZero ? ` and "${normalized.normalizeZero}" = 0%` : ' (0% = 0)'}.`
        );
      }
    }
  }

  if (normalized.arithmeticOp !== 'none' && Number.isFinite(normalized.arithmeticValue)) {
    const operand = normalized.arithmeticValue;
    if (normalized.arithmeticOp === 'divide' && operand === 0) {
      warnings.push('Arithmetic skipped: cannot divide by zero.');
    } else {
      Object.keys(current).forEach((well) => {
        const value = current[well];
        if (normalized.arithmeticOp === 'add') current[well] = value + operand;
        else if (normalized.arithmeticOp === 'subtract') current[well] = value - operand;
        else if (normalized.arithmeticOp === 'multiply') current[well] = value * operand;
        else current[well] = value / operand;
      });
      steps.push(`${ARITHMETIC_LABELS[normalized.arithmeticOp]} ${formatValue(operand)}.`);
    }
  }

  if (normalized.transform !== 'none') {
    let dropped = 0;
    const next = {};
    Object.entries(current).forEach(([well, value]) => {
      const transformed = applyValueTransform(value, normalized.transform);
      if (Number.isFinite(transformed)) {
        next[well] = transformed;
      } else {
        dropped += 1;
      }
    });
    current = next;
    steps.push(
      `Applied ${TRANSFORM_LABELS[normalized.transform]}`
      + `${dropped ? ` (${dropped} well(s) dropped as undefined)` : ''}.`
    );
  }

  const derived = {};
  Object.entries(current).forEach(([well, value]) => {
    derived[well] = formatValue(value);
  });

  return {
    results: derived,
    numericResults: current,
    steps,
    warnings,
    wellCount: Object.keys(current).length
  };
}

// Read-only render of the derived plate. Small enough not to warrant the editable
// grid the raw plate uses.
export function buildDerivedPlateTable(results, definition, safeText) {
  const escape = typeof safeText === 'function' ? safeText : (value) => String(value);
  const def = definition;
  const wells = buildAllWells(def);
  const byWell = new Map(wells.map((well) => [well.well, results[well.well] ?? '']));
  const header = ['', ...Array.from({ length: def.columns }, (_, index) => String(index + 1))];
  const rows = Array.from({ length: def.rows }, (_, rowIndex) => [
    toRowLabel(rowIndex),
    ...Array.from({ length: def.columns }, (_, columnIndex) => (
      byWell.get(wellIdFor(rowIndex, columnIndex)) || ''
    ))
  ]);

  return `
    <table class="assay-plate-table assay-derived-plate-table">
      <thead>
        <tr>${header.map((cell) => `<th>${escape(cell)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <th scope="row">${escape(row[0])}</th>
            ${row.slice(1).map((cell) => `<td>${escape(cell)}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export {
  ARITHMETIC_OPS,
  VALUE_TRANSFORMS,
  TRANSFORM_MODES,
  normalizeTransformSpec,
  isTransformActive
} from './derived-plate/transform-spec.js';
export { resolveReferenceWells } from './derived-plate/reference-wells.js';
export { applyPlateFormula, applyPlateCellFormulas } from './derived-plate/plate-formulas.js';
