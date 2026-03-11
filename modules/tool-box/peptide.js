const RESIDUE_MASS = {
  A: 71.08,
  R: 156.19,
  N: 114.1,
  D: 115.09,
  C: 103.15,
  E: 129.12,
  Q: 128.13,
  G: 57.05,
  H: 137.14,
  I: 113.16,
  L: 113.16,
  K: 128.17,
  M: 131.19,
  F: 147.18,
  P: 97.12,
  S: 87.08,
  T: 101.11,
  W: 186.21,
  Y: 163.18,
  V: 99.13
};

const PKA = {
  nTerminus: 9.69,
  cTerminus: 2.34,
  K: 10.54,
  R: 12.48,
  H: 6.04,
  D: 3.9,
  E: 4.07,
  C: 8.37,
  Y: 10.46
};

export function cleanSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

export function countResidues(sequence) {
  const counts = {};
  for (const aa of sequence) {
    counts[aa] = (counts[aa] || 0) + 1;
  }
  return counts;
}

export function calculatePeptideMass(sequence) {
  if (!sequence.length) {
    return 0;
  }

  const residueSum = [...sequence].reduce((sum, aa) => sum + (RESIDUE_MASS[aa] || 0), 0);
  return residueSum + 18.015;
}

export function positiveCharge(pH, pKa, count) {
  return count * (1 / (1 + 10 ** (pH - pKa)));
}

export function negativeCharge(pH, pKa, count) {
  return count * (1 / (1 + 10 ** (pKa - pH)));
}

export function calculateNetCharge(sequence, pH) {
  const counts = countResidues(sequence);
  const positive =
    positiveCharge(pH, PKA.nTerminus, 1) +
    positiveCharge(pH, PKA.K, counts.K || 0) +
    positiveCharge(pH, PKA.R, counts.R || 0) +
    positiveCharge(pH, PKA.H, counts.H || 0);

  const negative =
    negativeCharge(pH, PKA.cTerminus, 1) +
    negativeCharge(pH, PKA.D, counts.D || 0) +
    negativeCharge(pH, PKA.E, counts.E || 0) +
    negativeCharge(pH, PKA.C, counts.C || 0) +
    negativeCharge(pH, PKA.Y, counts.Y || 0);

  return positive - negative;
}

export function estimatePI(sequence) {
  if (!sequence.length) {
    return 0;
  }

  let low = 0;
  let high = 14;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const charge = calculateNetCharge(sequence, mid);
    if (charge > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

export function residueSummary(counts) {
  const keys = Object.keys(counts).sort();
  return keys.map((key) => `${key}:${counts[key]}`).join('  ');
}

export function peptideStats(sequence) {
  const counts = countResidues(sequence);
  const invalidResidues = [...sequence].filter((aa) => !RESIDUE_MASS[aa]);
  const mass = calculatePeptideMass(sequence);
  const netCharge7 = calculateNetCharge(sequence, 7);
  const pI = estimatePI(sequence);

  const tyr = counts.Y || 0;
  const trp = counts.W || 0;
  const cys = counts.C || 0;

  return {
    counts,
    invalidResidues,
    length: sequence.length,
    mass,
    netCharge7,
    pI,
    extinctionReduced: 5500 * trp + 1490 * tyr,
    extinctionOxidized: 5500 * trp + 1490 * tyr + 125 * Math.floor(cys / 2)
  };
}
