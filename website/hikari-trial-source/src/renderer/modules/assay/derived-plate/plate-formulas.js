import { isValidWellForDefinition } from '../plate-model.js';
import { parseDimensionGroupSpec } from '../analysis/shared.js';
import { FormulaError, compileFormula } from '../../../lib/formula.js';
import { blockWells, collectReferenceNodes, describeFormulaError, formatValue, readNumericPlate, referenceNodeLabel, referenceTable } from './plate-values.js';
import { resolveReferenceWells } from './reference-wells.js';
import { cleanFormulaCells } from './transform-spec.js';

// raw plate -- so a bad reference is one clear message instead of every well failing,
// and no well can see another well's transformed value.
function applyPlateFormula({
  results = {},
  formula,
  definition,
  rowGroupSpec = '',
  columnGroupSpec = ''
} = {}) {
  const def = definition;
  const numeric = readNumericPlate(results, def);
  const empty = { results: {}, numericResults: {}, steps: [], wellCount: 0 };

  const compiled = compileFormula(formula);
  if (compiled.error) {
    return { ...empty, warnings: [describeFormulaError(compiled.error)], formulaError: compiled.error };
  }

  const groupSpecs = {
    row: parseDimensionGroupSpec(rowGroupSpec, 'row', def.rows),
    column: parseDimensionGroupSpec(columnGroupSpec, 'column', def.columns)
  };

  const resolved = new Map();
  try {
    collectReferenceNodes(compiled.ast).forEach((node) => {
      const key = referenceNodeLabel(node);
      if (resolved.has(key)) {
        return;
      }
      if (referenceTable(node) !== 'table1') {
        throw new FormulaError(`"${key}" is unavailable in a whole-plate formula.`, node.position);
      }
      const wells = node.kind === 'range'
        ? blockWells(node.from, node.to, def)
        : (() => {
          const hit = resolveReferenceWells(node.name, def, groupSpecs);
          return hit.unresolved.length || !hit.wells.length ? null : hit.wells;
        })();
      if (!wells) {
        throw new FormulaError(`"${key}" is not a well, row, block or group on this plate.`, node.position);
      }
      const values = wells.map((well) => numeric[well]).filter((value) => Number.isFinite(value));
      if (!values.length) {
        throw new FormulaError(`"${key}" has no numeric results.`, node.position);
      }
      resolved.set(key, values);
    });
  } catch (error) {
    return { ...empty, warnings: [describeFormulaError(error)], formulaError: error };
  }

  const resolveRef = (node) => resolved.get(referenceNodeLabel(node));
  const next = {};
  const warnings = [];
  let dropped = 0;
  let firstFailure = null;

  Object.entries(numeric).forEach(([well, value]) => {
    try {
      const computed = compiled.evaluate({ value, resolveRef });
      if (Number.isFinite(computed)) {
        next[well] = computed;
      } else {
        dropped += 1;
      }
    } catch (error) {
      dropped += 1;
      firstFailure = firstFailure || error;
    }
  });

  if (firstFailure) {
    warnings.push(describeFormulaError(firstFailure));
  }

  const derived = {};
  Object.entries(next).forEach(([well, value]) => {
    derived[well] = formatValue(value);
  });

  return {
    results: derived,
    numericResults: next,
    steps: [`Applied formula ${String(formula).trim()}${dropped ? ` (${dropped} well(s) dropped as undefined)` : ''}.`],
    warnings,
    wellCount: Object.keys(next).length
  };
}

// Evaluates the formula stored in each transformed cell. Bare references and Table1
// read the original Plate Results; Table2 reads computed cells in the transformed
// plate. The explicit names let point-mode clicks mix both tables in one formula while
// keeping old formulas such as =A2 backward compatible.
function applyPlateCellFormulas({
  results = {},
  formulas = {},
  definition,
  rowGroupSpec = '',
  columnGroupSpec = ''
} = {}) {
  const def = definition;
  const numeric = readNumericPlate(results, def);
  const normalizedFormulas = cleanFormulaCells(formulas);
  const groupSpecs = {
    row: parseDimensionGroupSpec(rowGroupSpec, 'row', def.rows),
    column: parseDimensionGroupSpec(columnGroupSpec, 'column', def.columns)
  };
  const next = {};
  const derived = {};
  const cells = {};
  const warnings = [];
  const visiting = new Set();

  function wellsForNode(node) {
    const wells = node.kind === 'range'
      ? blockWells(node.from, node.to, def)
      : (() => {
        const hit = resolveReferenceWells(node.name, def, groupSpecs);
        return hit.unresolved.length || !hit.wells.length ? null : hit.wells;
      })();
    if (!wells) {
      throw new FormulaError(
        `"${referenceNodeLabel(node)}" is not a well, row, block or group on this plate.`,
        node.position
      );
    }
    return wells;
  }

  function transformedValueAt(well) {
    if (Number.isFinite(next[well])) {
      return next[well];
    }
    if (cells[well]?.error) {
      throw new FormulaError(cells[well].error.replace(/^Formula error:\s*/, ''));
    }
    if (visiting.has(well)) {
      throw new FormulaError(`"Table2:${well}" creates a circular reference.`);
    }
    const formula = normalizedFormulas[well];
    if (!formula) {
      throw new FormulaError(`"Table2:${well}" is empty.`);
    }

    const compiled = compileFormula(formula);
    if (compiled.error) {
      throw compiled.error;
    }
    visiting.add(well);
    try {
      const computed = compiled.evaluate({
        value: numeric[well],
        resolveRef
      });
      if (!Number.isFinite(computed)) {
        throw new FormulaError('The formula result is not a finite number.');
      }
      next[well] = computed;
      derived[well] = formatValue(computed);
      cells[well] = { formula, value: computed, text: derived[well], error: '' };
      return computed;
    } finally {
      visiting.delete(well);
    }
  }

  function resolveRef(node) {
    const key = referenceNodeLabel(node);
    const table = referenceTable(node);
    if (table !== 'table1' && table !== 'table2') {
      throw new FormulaError(`Unknown table "${node.table}". Use Table1 or Table2.`, node.position);
    }
    const wells = wellsForNode(node);
    const values = [];
    wells.forEach((sourceWell) => {
      if (table === 'table1') {
        if (Number.isFinite(numeric[sourceWell])) {
          values.push(numeric[sourceWell]);
        }
        return;
      }
      if (!normalizedFormulas[sourceWell]) {
        return;
      }
      values.push(transformedValueAt(sourceWell));
    });
    if (!values.length) {
      throw new FormulaError(`"${key}" has no numeric results.`, node.position);
    }
    return values;
  }

  Object.entries(normalizedFormulas).forEach(([well, formula]) => {
    if (!isValidWellForDefinition(well, def) || cells[well]) {
      return;
    }
    try {
      transformedValueAt(well);
    } catch (error) {
      const message = describeFormulaError(error);
      cells[well] = { formula, error: message };
      warnings.push(`${well}: ${message}`);
    }
  });

  const formulaCount = Object.keys(normalizedFormulas)
    .filter((well) => isValidWellForDefinition(well, def))
    .length;
  const errorCount = formulaCount - Object.keys(next).length;
  return {
    results: derived,
    numericResults: next,
    formulas: normalizedFormulas,
    cells,
    steps: formulaCount
      ? [`Calculated ${Object.keys(next).length} of ${formulaCount} transformed cell(s).`]
      : [],
    warnings,
    formulaCount,
    errorCount,
    wellCount: Object.keys(next).length
  };
}

export {
  applyPlateCellFormulas,
  applyPlateFormula
};
