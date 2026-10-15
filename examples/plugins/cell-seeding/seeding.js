// Cell seeding math: a hemocytometer count to viable cells/mL, then the cell
// suspension and medium that seed a plate. No host calls, so the page and its
// self-check (`node seeding.js`) share it.

// One large Neubauer square holds 0.1 µL, so each cell in it is 10^4 cells/mL.
const CELLS_PER_ML_PER_SQUARE_CELL = 1e4;

function parseCounts(text) {
  const tokens = String(text || '').split(/[\s,;]+/).filter(Boolean);
  return tokens.every((token) => /^\d+$/.test(token)) ? tokens.map(Number) : null;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

function countCells({ live, dead, dilution }) {
  const liveCounts = parseCounts(live);
  const deadCounts = parseCounts(dead);
  if (!liveCounts || !deadCounts) {
    return { ok: false, error: 'Counts must be whole numbers separated by spaces or commas.' };
  }
  if (!liveCounts.length) {
    return { ok: false, error: 'Enter the live count for at least one square.' };
  }
  if (deadCounts.length && deadCounts.length !== liveCounts.length) {
    return { ok: false, error: 'Enter a dead count for each square counted, or leave dead counts empty.' };
  }
  if (!Number.isFinite(dilution) || dilution < 1) {
    return { ok: false, error: 'Dilution factor must be 1 or more.' };
  }
  const liveTotal = sum(liveCounts);
  if (!liveTotal) {
    return { ok: false, error: 'No live cells were counted.' };
  }
  return {
    ok: true,
    squares: liveCounts.length,
    viableCellsPerMl: (liveTotal / liveCounts.length) * dilution * CELLS_PER_ML_PER_SQUARE_CELL,
    viability: deadCounts.length ? liveTotal / (liveTotal + sum(deadCounts)) : null
  };
}

function planSeeding({ viableCellsPerMl, wells, cellsPerWell, mediumPerWellMl, overagePercent }) {
  if (!Number.isInteger(wells) || wells < 1) return { ok: false, error: 'Wells must be a whole number of at least 1.' };
  if (!(cellsPerWell > 0)) return { ok: false, error: 'Enter the cells to seed per well.' };
  if (!(mediumPerWellMl > 0)) return { ok: false, error: 'Enter the medium volume per well.' };
  if (!(overagePercent >= 0)) return { ok: false, error: 'Overage must be 0% or more.' };
  // Mix for a few extra wells so pipetting losses do not short the last one.
  const wellsWithOverage = wells * (1 + overagePercent / 100);
  const totalCells = wellsWithOverage * cellsPerWell;
  const totalMl = wellsWithOverage * mediumPerWellMl;
  const suspensionMl = totalCells / viableCellsPerMl;
  if (suspensionMl > totalMl) {
    return {
      ok: false,
      error: `The cells are too dilute: ${formatVolume(suspensionMl)} of suspension is more than the ${formatVolume(totalMl)} total. Spin down and resuspend in less medium, then count again.`
    };
  }
  return { ok: true, wellsWithOverage, totalCells, totalMl, suspensionMl, mediumMl: totalMl - suspensionMl };
}

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

function formatCells(value) {
  const exponent = Math.floor(Math.log10(value));
  let mantissa = Number((value / 10 ** exponent).toFixed(2));
  let power = exponent;
  if (mantissa >= 10) { mantissa /= 10; power += 1; } // 9.996e5 rounds to 10.00
  const superscript = String(power).split('').map((digit) => SUPERSCRIPT[digit]).join('');
  return `${mantissa.toFixed(2)} × 10${superscript}`;
}

function formatVolume(ml) {
  if (ml >= 1) return `${ml.toFixed(2)} mL`;
  const ul = ml * 1000;
  return `${ul >= 100 ? ul.toFixed(0) : ul.toFixed(1)} µL`;
}

const formatPercent = (fraction) => `${(fraction * 100).toFixed(1)}%`;

// A notebook result: one summary line, and a two-column table that reads on
// its own (the notebook keeps no table title).
function buildRecord({ cellLine, count, plan, inputs }) {
  const name = String(cellLine || '').trim();
  const rows = [
    ['Calculation', 'Cell seeding'],
    ...(name ? [['Cell line', name]] : []),
    ['Viable cells/mL', `${formatCells(count.viableCellsPerMl)} (${count.squares} squares, dilution ×${inputs.dilution})`],
    ...(count.viability === null ? [] : [['Viability', formatPercent(count.viability)]]),
    ['Wells', `${inputs.wells} (+${inputs.overagePercent}% overage)`],
    ['Cells per well', formatCells(inputs.cellsPerWell)],
    ['Medium per well', formatVolume(inputs.mediumPerWellMl)],
    ['Cell suspension', formatVolume(plan.suspensionMl)],
    ['Medium', formatVolume(plan.mediumMl)],
    ['Total volume', formatVolume(plan.totalMl)]
  ];
  return {
    text: `Cell seeding${name ? ` (${name})` : ''}: ${formatVolume(plan.suspensionMl)} cell suspension + ${formatVolume(plan.mediumMl)} medium for ${inputs.wells} wells at ${formatCells(inputs.cellsPerWell)} cells/well.`,
    table: {
      columns: [{ field: 'item', title: 'Item' }, { field: 'value', title: 'Value' }],
      rows: rows.map(([item, value], index) => ({ id: `row_${index + 1}`, item, value }))
    }
  };
}

function demo() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`cell-seeding self-check failed: ${message}`);
  };
  const near = (actual, expected) => Math.abs(actual - expected) < expected * 1e-9;

  const count = countCells({ live: '52 47, 55\n50', dead: '3 5 2 4', dilution: 2 });
  assert(count.ok && count.squares === 4, 'four squares parsed from mixed separators');
  assert(near(count.viableCellsPerMl, 1.02e6), 'mean 51 × dilution 2 × 10^4 = 1.02 × 10^6 cells/mL');
  assert(near(count.viability, 204 / 218), 'viability is live over live + dead');
  assert(countCells({ live: '52 47', dead: '', dilution: 2 }).viability === null, 'no dead counts, no viability');
  assert(!countCells({ live: '52 4.5', dead: '', dilution: 2 }).ok, 'fractional counts are refused');
  assert(!countCells({ live: '52 47', dead: '3', dilution: 2 }).ok, 'dead counts must match the squares counted');
  assert(!countCells({ live: '0 0', dead: '', dilution: 2 }).ok, 'zero live cells is refused');
  assert(!countCells({ live: '52', dead: '', dilution: 0.5 }).ok, 'a dilution below 1 is refused');

  const inputs = { wells: 24, cellsPerWell: 5e4, mediumPerWellMl: 0.5, overagePercent: 10, dilution: 2 };
  const plan = planSeeding({ viableCellsPerMl: count.viableCellsPerMl, ...inputs });
  assert(plan.ok && near(plan.totalCells, 1.32e6), '24 wells + 10% at 5 × 10^4 cells = 1.32 × 10^6 cells');
  assert(near(plan.totalMl, 13.2) && near(plan.suspensionMl, 1.32e6 / 1.02e6), 'suspension = cells needed / cells per mL');
  assert(near(plan.suspensionMl + plan.mediumMl, plan.totalMl), 'suspension and medium make up the total');
  const dilute = planSeeding({ viableCellsPerMl: 1e4, ...inputs });
  assert(!dilute.ok && /too dilute/.test(dilute.error), 'more suspension than total volume is refused');
  assert(!planSeeding({ viableCellsPerMl: 1e6, ...inputs, wells: 2.5 }).ok, 'wells must be whole');

  assert(formatCells(1.02e6) === '1.02 × 10⁶', 'cells use scientific notation');
  assert(formatCells(9.996e5) === '1.00 × 10⁶', 'rounding up carries into the exponent');
  assert(formatVolume(1.2941) === '1.29 mL' && formatVolume(0.5) === '500 µL' && formatVolume(0.0125) === '12.5 µL', 'volumes switch to µL below 1 mL');

  const record = buildRecord({ cellLine: ' HeLa ', count, plan, inputs });
  assert(record.text === 'Cell seeding (HeLa): 1.29 mL cell suspension + 11.91 mL medium for 24 wells at 5.00 × 10⁴ cells/well.', 'summary line');
  assert(record.table.columns.every((column) => /^[a-z]+$/.test(column.field)), 'table fields are plain identifiers');
  assert(record.table.rows.find((row) => row.item === 'Viability').value === '93.6%', 'viability row');
  assert(!buildRecord({ cellLine: '', count: { ...count, viability: null }, plan, inputs }).table.rows
    .some((row) => row.item === 'Cell line' || row.item === 'Viability'), 'unknown values are left out, not shown blank');
  return 'cell-seeding self-check: ok';
}

const CellSeeding = Object.freeze({ countCells, planSeeding, buildRecord, formatCells, formatVolume, formatPercent });

if (typeof window !== 'undefined') {
  window.CellSeeding = CellSeeding;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ...CellSeeding, demo };
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('seeding.js')) {
  console.log(demo());
}
