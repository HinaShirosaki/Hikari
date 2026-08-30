// Units for spreadsheet table columns. A column keeps its unit in the parenthesised
// tail of its title -- "Volume (mL)" -- so the unit is visible, saved and exported
// with the table, and there is nowhere else for it to drift out of sync.
//
// Cells therefore always store a bare number in their column's unit: "5 uL" typed into
// a millilitre column is converted on entry, not carried around as text a formula
// would have to re-parse.

import { concentrationToM, massToG, volumeToL } from './molarity.js';

// Lower-cased spellings are unique across these three dimensions, so a typed unit
// needs no context to resolve: "nm" is nanomolar because no length unit lives here.
const DIMENSIONS = {
  mass: { units: ['ng', 'ug', 'mg', 'g', 'kg'], toBase: massToG },
  volume: { units: ['nL', 'uL', 'mL', 'L'], toBase: volumeToL },
  concentration: { units: ['fM', 'pM', 'nM', 'uM', 'mM', 'M'], toBase: concentrationToM }
};

const TITLE_UNIT = /\s*\(([^()]*)\)\s*$/;
const NUMBER_PREFIX = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(\S.*)$/;

// Float ratios leave noise (5 uL in mL is 0.005000000000000001).
function formatNumber(value) {
  return String(Number(value.toPrecision(12)));
}

export function parseUnit(text) {
  const clean = String(text ?? '').replace(/[µμ]/g, 'u').trim().toLowerCase();
  if (!clean) {
    return null;
  }
  for (const [dimension, spec] of Object.entries(DIMENSIONS)) {
    const unit = spec.units.find((candidate) => candidate.toLowerCase() === clean);
    if (unit) {
      return { dimension, unit, factor: spec.toBase(1, unit) };
    }
  }
  return null;
}

export function unitOptions(dimension) {
  return DIMENSIONS[dimension]?.units || [];
}

// The unit a column is kept in, or null for a column that carries none -- "Entry",
// "Column 3", and "MW (g/mol)" alike, since g/mol is not one of the three dimensions.
export function columnUnit(title) {
  const match = TITLE_UNIT.exec(String(title ?? ''));
  return match ? parseUnit(match[1]) : null;
}

export function columnUnitFactor(title, fallback = 1) {
  return columnUnit(title)?.factor ?? fallback;
}

export function columnBaseTitle(title) {
  const text = String(title ?? '');
  return columnUnit(text) ? text.replace(TITLE_UNIT, '') : text;
}

export function retitleColumnUnit(title, unit) {
  return `${columnBaseTitle(title)} (${unit})`;
}

// What a typed cell is stored as: a number with a unit of the column's own dimension
// is converted into the column's unit, everything else is kept exactly as typed --
// formulas, escaped text, prose, and units that do not belong to this column.
export function normalizeCellForColumn(raw, columnTitle) {
  const source = String(raw ?? '');
  const text = source.trim();
  const column = columnUnit(columnTitle);
  if (!column || !text || text.startsWith('=') || text.startsWith("'")) {
    return source;
  }
  const match = NUMBER_PREFIX.exec(text);
  const typed = match ? parseUnit(match[2]) : null;
  if (!typed || typed.dimension !== column.dimension) {
    return source;
  }
  return formatNumber((Number(match[1]) * typed.factor) / column.factor);
}

// Re-expressing a stored number when its column switches unit: 5 in a millilitre
// column becomes 5000 once the column is kept in microlitres. Anything that is not a
// plain number (a formula, a note) is left alone.
export function rescaleCellValue(raw, ratio) {
  const text = String(raw ?? '').trim();
  if (!text || text.startsWith('=') || text.startsWith("'")) {
    return String(raw ?? '');
  }
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? formatNumber(value * ratio) : String(raw ?? '');
}
