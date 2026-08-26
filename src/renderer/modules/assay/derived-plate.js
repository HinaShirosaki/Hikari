import {
  buildAllWells,
  isValidWellForDefinition,
  parseWellId,
  rowLabelToIndex,
  toRowLabel,
  wellIdFor
} from './plate-model.js';
import { parseDimensionGroupSpec } from './analysis/shared.js';
import { parseNumericResult } from './shared.js';
import { compileFormula, FormulaError } from '../../lib/formula.js';

// A derived plate: the raw result plate with up to four optional steps applied, in a
// fixed order that matches how the numbers are meant to be handled --
//   blank subtraction -> normalisation -> constant arithmetic -> value transform.
// The order is fixed on purpose; a reorderable pipeline would let you normalise
// before removing background, which is the wrong answer with more UI.

export const ARITHMETIC_OPS = Object.freeze(['none', 'add', 'subtract', 'multiply', 'divide']);
export const VALUE_TRANSFORMS = Object.freeze(['none', 'log10', 'ln', 'sqrt', 'reciprocal', 'square']);
export const TRANSFORM_MODES = Object.freeze(['steps', 'formula', 'cells']);

const TRANSFORM_LABELS = Object.freeze({
  log10: 'log10(x)',
  ln: 'ln(x)',
  sqrt: 'sqrt(x)',
  reciprocal: '1/x',
  square: 'x^2'
});

const ARITHMETIC_LABELS = Object.freeze({
  add: 'Added',
  subtract: 'Subtracted',
  multiply: 'Multiplied by',
  divide: 'Divided by'
});

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function cleanReference(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanFormulaCells(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce((cells, [rawWell, rawFormula]) => {
    const well = String(rawWell || '').trim().toUpperCase();
    const formula = String(rawFormula || '').trim().slice(0, 500);
    if (well && formula) {
      cells[well] = formula;
    }
    return cells;
  }, {});
}

export function normalizeTransformSpec(input) {
  const source = input && typeof input === 'object' ? input : {};
  // Number('') is 0, and the operand arrives as a raw DOM string: an empty box has to
  // stay null or "multiply" would silently zero the whole plate.
  const rawArithmetic = String(source.arithmeticValue ?? '').trim();
  const arithmeticValue = rawArithmetic ? Number(rawArithmetic) : NaN;
  return {
    mode: pick(source.mode, TRANSFORM_MODES, 'steps'),
    formulas: cleanFormulaCells(source.formulas),
    formula: String(source.formula || '').slice(0, 500),
    blank: cleanReference(source.blank),
    normalizeHundred: cleanReference(source.normalizeHundred),
    normalizeZero: cleanReference(source.normalizeZero),
    arithmeticOp: pick(source.arithmeticOp, ARITHMETIC_OPS, 'none'),
    arithmeticValue: Number.isFinite(arithmeticValue) ? arithmeticValue : null,
    transform: pick(source.transform, VALUE_TRANSFORMS, 'none')
  };
}

export function isTransformActive(spec) {
  const normalized = normalizeTransformSpec(spec);
  if (normalized.mode === 'cells') {
    return Boolean(Object.keys(normalized.formulas).length);
  }
  if (normalized.mode === 'formula') {
    return Boolean(normalized.formula.trim());
  }
  return Boolean(
    normalized.blank
    || normalized.normalizeHundred
    || normalized.normalizeZero
    || (normalized.arithmeticOp !== 'none' && Number.isFinite(normalized.arithmeticValue))
    || normalized.transform !== 'none'
  );
}

function wellsForRow(rowLabel, def) {
  const rowIndex = rowLabelToIndex(rowLabel);
  if (rowIndex < 0 || rowIndex >= def.rows) {
    return [];
  }
  return Array.from({ length: def.columns }, (_, column) => wellIdFor(rowIndex, column));
}

function wellsForColumn(columnNumber, def) {
  const columnIndex = Number(columnNumber) - 1;
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= def.columns) {
    return [];
  }
  return Array.from({ length: def.rows }, (_, row) => wellIdFor(row, columnIndex));
}

function groupWells(token, def, groupSpecs) {
  const lowered = token.toLowerCase();
  const rowGroup = groupSpecs.row.groups.find((group) => group.label.toLowerCase() === lowered);
  if (rowGroup) {
    return rowGroup.members.flatMap((member) => wellsForRow(member, def));
  }
  const columnGroup = groupSpecs.column.groups.find((group) => group.label.toLowerCase() === lowered);
  if (columnGroup) {
    return columnGroup.members.flatMap((member) => wellsForColumn(member, def));
  }
  return [];
}

// A reference is a comma/space separated list of wells (A1), whole rows (A, A-C),
// whole columns (3, 3-5), or the name of a custom group. Plate coordinates are
// matched first, so a group named "A" does not shadow row A.
export function resolveReferenceWells(reference, def, groupSpecs) {
  const text = cleanReference(reference);
  if (!text) {
    return { wells: [], unresolved: [] };
  }
  const wells = new Set();
  const unresolved = [];

  text.split(/[,;]+/).map((part) => part.trim()).filter(Boolean).forEach((token) => {
    const upper = token.toUpperCase();

    if (/^[A-Z]+\d+$/.test(upper)) {
      if (parseWellId(upper) && isValidWellForDefinition(upper, def)) {
        wells.add(upper);
        return;
      }
      // Not a well on this plate, so fall through to the group table: a group named
      // "Ctrl1" is well-shaped but is still a legitimate reference.
      const viaGroup = groupWells(token, def, groupSpecs);
      if (viaGroup.length) viaGroup.forEach((well) => wells.add(well));
      else unresolved.push(token);
      return;
    }

    const rowRange = upper.match(/^([A-Z]+)-([A-Z]+)$/);
    if (rowRange) {
      const start = rowLabelToIndex(rowRange[1]);
      const end = rowLabelToIndex(rowRange[2]);
      const found = [];
      for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) {
        found.push(...wellsForRow(toRowLabel(index), def));
      }
      if (found.length) found.forEach((well) => wells.add(well));
      else unresolved.push(token);
      return;
    }

    if (/^[A-Z]+$/.test(upper)) {
      const found = wellsForRow(upper, def);
      if (found.length) found.forEach((well) => wells.add(well));
      else {
        const viaGroup = groupWells(token, def, groupSpecs);
        if (viaGroup.length) viaGroup.forEach((well) => wells.add(well));
        else unresolved.push(token);
      }
      return;
    }

    const columnRange = upper.match(/^(\d+)-(\d+)$/);
    if (columnRange) {
      const start = Number(columnRange[1]);
      const end = Number(columnRange[2]);
      const found = [];
      for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) {
        found.push(...wellsForColumn(index, def));
      }
      if (found.length) found.forEach((well) => wells.add(well));
      else unresolved.push(token);
      return;
    }

    if (/^\d+$/.test(upper)) {
      const found = wellsForColumn(upper, def);
      if (found.length) found.forEach((well) => wells.add(well));
      else unresolved.push(token);
      return;
    }

    const viaGroup = groupWells(token, def, groupSpecs);
    if (viaGroup.length) viaGroup.forEach((well) => wells.add(well));
    else unresolved.push(token);
  });

  return { wells: Array.from(wells), unresolved };
}

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
// raw plate -- so a bad reference is one clear message instead of every well failing,
// and no well can see another well's transformed value.
export function applyPlateFormula({
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
export function applyPlateCellFormulas({
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
