import { translateDnaCodon } from '../tool-box/sequence.js';
import {
  clamp,
  normalizeSequenceText,
  reverseComplementIupac
} from './shared.js';

const WATER_MONOISOTOPIC_MASS = 18.010565;

const MONOISOTOPIC_RESIDUE_MASS = Object.freeze({
  A: 71.037114,
  R: 156.101111,
  N: 114.042927,
  D: 115.026943,
  C: 103.009185,
  E: 129.042593,
  Q: 128.058578,
  G: 57.021464,
  H: 137.058912,
  I: 113.084064,
  L: 113.084064,
  K: 128.094963,
  M: 131.040485,
  F: 147.068414,
  P: 97.052764,
  S: 87.032028,
  T: 101.047679,
  W: 186.079313,
  Y: 163.063329,
  V: 99.068414
});

const PKA = Object.freeze({
  nTerminus: 9.69,
  cTerminus: 2.34,
  K: 10.54,
  R: 12.48,
  H: 6.04,
  D: 3.9,
  E: 4.07,
  C: 8.37,
  Y: 10.46
});

function normalizeProteinSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z*]/g, '');
}

function trimProteinAtFirstStop(proteinSequence) {
  const normalized = normalizeProteinSequence(proteinSequence);
  const stopIndex = normalized.indexOf('*');
  return stopIndex >= 0 ? normalized.slice(0, stopIndex) : normalized;
}

function countResidues(sequence) {
  const counts = {};
  for (const residue of sequence) {
    counts[residue] = (counts[residue] || 0) + 1;
  }
  return counts;
}

function positiveCharge(pH, pKa, count) {
  return count * (1 / (1 + 10 ** (pH - pKa)));
}

function negativeCharge(pH, pKa, count) {
  return count * (1 / (1 + 10 ** (pKa - pH)));
}

function calculateNetCharge(sequence, pH) {
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

function estimatePI(sequence) {
  if (!sequence.length) {
    return null;
  }

  let low = 0;
  let high = 14;
  for (let index = 0; index < 60; index += 1) {
    const mid = (low + high) / 2;
    if (calculateNetCharge(sequence, mid) > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function normalizeSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  if (!safeLength) {
    return [];
  }
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      return end > start ? { start, end } : null;
    })
    .filter(Boolean);
}

function extractFeatureDnaSequence(feature, recordSequence) {
  const sequence = normalizeSequenceText(recordSequence || '');
  if (!sequence.length || !feature) {
    return '';
  }

  const segments = normalizeSegments(feature?.segments, sequence.length);
  if (!segments.length) {
    return '';
  }

  const raw = segments.map((segment) => sequence.slice(segment.start, segment.end)).join('');
  return Number(feature?.strand) === -1 ? reverseComplementIupac(raw) : raw;
}

function translateDnaToProtein(dnaSequence) {
  const sequence = normalizeSequenceText(dnaSequence);
  const codonCount = Math.floor(sequence.length / 3);
  let protein = '';
  for (let index = 0; index < codonCount; index += 1) {
    const residue = translateDnaCodon(sequence.slice(index * 3, (index * 3) + 3));
    if (residue === '*') {
      break;
    }
    protein += residue || 'X';
  }
  return protein;
}

export function resolveCdsProteinSequence(feature, recordSequence = '') {
  if (String(feature?.type || '').toLowerCase() !== 'cds') {
    return null;
  }

  const qualifierProtein = trimProteinAtFirstStop(feature?.translation || feature?.proteinSequence || '');
  if (qualifierProtein) {
    return {
      proteinSequence: qualifierProtein,
      source: 'qualifier'
    };
  }

  const dnaSequence = extractFeatureDnaSequence(feature, recordSequence);
  const derivedProtein = translateDnaToProtein(dnaSequence);
  if (!derivedProtein) {
    return null;
  }
  return {
    proteinSequence: derivedProtein,
    source: 'derived',
    dnaLength: dnaSequence.length
  };
}

export function calculateProteinProperties(proteinSequence) {
  const sequence = trimProteinAtFirstStop(proteinSequence);
  if (!sequence.length) {
    return null;
  }

  const invalidResidues = [...new Set([...sequence].filter((residue) => !MONOISOTOPIC_RESIDUE_MASS[residue]))].sort();
  const canCalculateExactProperties = invalidResidues.length === 0;
  const monoisotopicMass = canCalculateExactProperties
    ? [...sequence].reduce((sum, residue) => sum + MONOISOTOPIC_RESIDUE_MASS[residue], WATER_MONOISOTOPIC_MASS)
    : null;

  return {
    sequence,
    length: sequence.length,
    monoisotopicMass,
    pI: canCalculateExactProperties ? estimatePI(sequence) : null,
    invalidResidues
  };
}

export function getCdsProteinProperties(feature, recordSequence = '') {
  const resolved = resolveCdsProteinSequence(feature, recordSequence);
  if (!resolved?.proteinSequence) {
    return null;
  }
  const properties = calculateProteinProperties(resolved.proteinSequence);
  if (!properties) {
    return null;
  }
  return {
    ...properties,
    proteinSequence: resolved.proteinSequence,
    source: resolved.source,
    dnaLength: resolved.dnaLength || 0
  };
}
