'use strict';

const TOOLBOX_CONCENTRATION_TO_M = Object.freeze({
  fM: 1e-15,
  pM: 1e-12,
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
  M: 1
});

const TOOLBOX_VOLUME_TO_L = Object.freeze({
  uL: 1e-6,
  mL: 1e-3,
  L: 1
});

const TOOLBOX_MASS_TO_G = Object.freeze({
  ug: 1e-6,
  mg: 1e-3,
  g: 1,
  kg: 1e3
});

const TOOLBOX_DNA_BASE_MW = Object.freeze({ A: 313.21, T: 304.2, G: 329.21, C: 289.18 });
const TOOLBOX_RNA_BASE_MW = Object.freeze({ A: 329.21, U: 306.17, G: 345.21, C: 305.18 });
const TOOLBOX_DNA_EXTINCTION = Object.freeze({ A: 15400, C: 7400, G: 11500, T: 8700 });
const TOOLBOX_RNA_EXTINCTION = Object.freeze({ A: 15400, C: 7400, G: 11500, U: 9900 });
const TOOLBOX_COMPLEMENT = Object.freeze({ A: 'T', T: 'A', C: 'G', G: 'C' });
const TOOLBOX_CODON_TABLE = Object.freeze({
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
});

const TOOLBOX_AA_TO_CODONS = Object.freeze({
  A: ['GCT', 'GCC', 'GCA', 'GCG'],
  C: ['TGT', 'TGC'],
  D: ['GAT', 'GAC'],
  E: ['GAA', 'GAG'],
  F: ['TTT', 'TTC'],
  G: ['GGT', 'GGC', 'GGA', 'GGG'],
  H: ['CAT', 'CAC'],
  I: ['ATT', 'ATC', 'ATA'],
  K: ['AAA', 'AAG'],
  L: ['CTG', 'CTC', 'CTT', 'TTA', 'TTG', 'CTA'],
  M: ['ATG'],
  N: ['AAT', 'AAC'],
  P: ['CCT', 'CCC', 'CCA', 'CCG'],
  Q: ['CAA', 'CAG'],
  R: ['CGT', 'CGC', 'CGG', 'AGA', 'AGG', 'CGA'],
  S: ['TCT', 'TCC', 'TCA', 'TCG', 'AGC', 'AGT'],
  T: ['ACT', 'ACC', 'ACA', 'ACG'],
  V: ['GTG', 'GTT', 'GTC', 'GTA'],
  W: ['TGG'],
  Y: ['TAT', 'TAC'],
  '*': ['TAA', 'TGA', 'TAG']
});

const TOOLBOX_PEPTIDE_RESIDUE_MASS = Object.freeze({
  A: 71.08, R: 156.19, N: 114.1, D: 115.09, C: 103.15,
  E: 129.12, Q: 128.13, G: 57.05, H: 137.14, I: 113.16,
  L: 113.16, K: 128.17, M: 131.19, F: 147.18, P: 97.12,
  S: 87.08, T: 101.11, W: 186.21, Y: 163.18, V: 99.13
});

const TOOLBOX_PEPTIDE_PKA = Object.freeze({
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

const TOOLBOX_IUPAC_BASE_MAP = Object.freeze({
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'GC',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT'
});

const TOOLBOX_IUPAC_COMPLEMENT_MAP = Object.freeze({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N'
});

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function toolboxConcentrationToM(value, unit) {
  return toFiniteNumber(value) * (TOOLBOX_CONCENTRATION_TO_M[unit] || 0);
}

function toolboxConcentrationFromM(valueM, unit) {
  const factor = TOOLBOX_CONCENTRATION_TO_M[unit] || 0;
  return factor ? valueM / factor : 0;
}

function toolboxVolumeToL(value, unit) {
  return toFiniteNumber(value) * (TOOLBOX_VOLUME_TO_L[unit] || 0);
}

function toolboxVolumeFromL(valueL, unit) {
  const factor = TOOLBOX_VOLUME_TO_L[unit] || 0;
  return factor ? valueL / factor : 0;
}

function toolboxMassToG(value, unit) {
  return toFiniteNumber(value) * (TOOLBOX_MASS_TO_G[unit] || 0);
}

function toolboxMassFromG(valueG, unit) {
  const factor = TOOLBOX_MASS_TO_G[unit] || 0;
  return factor ? valueG / factor : 0;
}

function cleanNucleotideSequenceForToolbox(raw, type = 'DNA') {
  const normalized = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (String(type || '').toUpperCase() === 'RNA') {
    return normalized.replace(/T/g, 'U').replace(/[^ACGU]/g, '');
  }
  return normalized.replace(/U/g, 'T').replace(/[^ACGT]/g, '');
}

function countNucleotideResidues(sequence) {
  const counts = {};
  for (const base of String(sequence || '')) {
    counts[base] = (counts[base] || 0) + 1;
  }
  return counts;
}

function reverseComplementDnaForToolbox(sequence) {
  return [...String(sequence || '')]
    .reverse()
    .map((base) => TOOLBOX_COMPLEMENT[base] || 'N')
    .join('');
}

function translateDnaSequenceForToolbox(sequence, frame = 1, stopMode = 'star') {
  const numericFrame = toFiniteNumber(frame, 1);
  const isNegativeStrand = numericFrame < 0;
  const absFrame = Math.max(1, Math.min(3, Math.abs(Math.round(numericFrame)) || 1));
  const startIndex = absFrame - 1;
  const template = isNegativeStrand ? reverseComplementDnaForToolbox(sequence) : sequence;
  const coding = template.slice(startIndex);
  let protein = '';
  let codons = 0;

  for (let i = 0; i + 2 < coding.length; i += 3) {
    const codon = coding.slice(i, i + 3);
    const aa = TOOLBOX_CODON_TABLE[codon] || 'X';
    codons += 1;
    if (aa === '*' && stopMode === 'trim') {
      break;
    }
    protein += aa;
  }

  return {
    protein,
    codons,
    frame: absFrame,
    strand: isNegativeStrand ? '-' : '+',
    remainderBases: coding.length % 3
  };
}

function cleanProteinSequenceForToolbox(raw, allowStop = true) {
  const disallowed = allowStop ? /[^A-Z*]/g : /[^A-Z]/g;
  return String(raw || '').toUpperCase().replace(disallowed, '');
}

function countProteinResidues(sequence) {
  const counts = {};
  for (const aa of String(sequence || '')) {
    counts[aa] = (counts[aa] || 0) + 1;
  }
  return counts;
}

function positiveChargeForToolbox(pH, pKa, count) {
  return count * (1 / (1 + (10 ** (pH - pKa))));
}

function negativeChargeForToolbox(pH, pKa, count) {
  return count * (1 / (1 + (10 ** (pKa - pH))));
}

function calculateNetChargeForToolbox(sequence, pH = 7) {
  const counts = countProteinResidues(sequence);
  const positive =
    positiveChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.nTerminus, 1) +
    positiveChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.K, counts.K || 0) +
    positiveChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.R, counts.R || 0) +
    positiveChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.H, counts.H || 0);
  const negative =
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.cTerminus, 1) +
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.D, counts.D || 0) +
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.E, counts.E || 0) +
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.C, counts.C || 0) +
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.Y, counts.Y || 0);
  return positive - negative;
}

function estimateIsoelectricPointForToolbox(sequence) {
  if (!sequence.length) {
    return 0;
  }
  let low = 0;
  let high = 14;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const charge = calculateNetChargeForToolbox(sequence, mid);
    if (charge > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function calculatePeptideStatsForToolbox(sequence, ph = 7) {
  const counts = countProteinResidues(sequence);
  const invalidResidues = [...sequence].filter((aa) => !TOOLBOX_PEPTIDE_RESIDUE_MASS[aa]);
  const residueMass = [...sequence].reduce((sum, aa) => sum + (TOOLBOX_PEPTIDE_RESIDUE_MASS[aa] || 0), 0);
  const mass = sequence.length ? residueMass + 18.015 : 0;
  const netCharge = calculateNetChargeForToolbox(sequence, ph);
  const pI = estimateIsoelectricPointForToolbox(sequence);
  const tyr = counts.Y || 0;
  const trp = counts.W || 0;
  const cys = counts.C || 0;
  return {
    counts,
    invalidResidues: [...new Set(invalidResidues)],
    length: sequence.length,
    mass,
    net_charge: netCharge,
    pI,
    extinction_reduced: 5500 * trp + 1490 * tyr,
    extinction_oxidized: 5500 * trp + 1490 * tyr + (125 * Math.floor(cys / 2))
  };
}

function oligoMolecularWeightForToolbox(sequence, type = 'DNA') {
  const map = String(type || '').toUpperCase() === 'RNA'
    ? TOOLBOX_RNA_BASE_MW
    : TOOLBOX_DNA_BASE_MW;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

function oligoExtinctionForToolbox(sequence, type = 'DNA') {
  const map = String(type || '').toUpperCase() === 'RNA'
    ? TOOLBOX_RNA_EXTINCTION
    : TOOLBOX_DNA_EXTINCTION;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

function oligoTmForToolbox(sequence, type = 'DNA') {
  const counts = countNucleotideResidues(sequence);
  const a = counts.A || 0;
  const g = counts.G || 0;
  const c = counts.C || 0;
  const tOrU = String(type || '').toUpperCase() === 'RNA' ? (counts.U || 0) : (counts.T || 0);
  const n = sequence.length;
  if (!n) {
    return 0;
  }
  if (n < 14) {
    return (2 * (a + tOrU)) + (4 * (g + c));
  }
  return 64.9 + ((41 * ((g + c) - 16.4)) / n);
}

function linearRegressionForToolbox(xValues, yValues) {
  const n = xValues.length;
  if (!n || n !== yValues.length) {
    return null;
  }
  const xMean = xValues.reduce((sum, value) => sum + value, 0) / n;
  const yMean = yValues.reduce((sum, value) => sum + value, 0) / n;
  let ssXX = 0;
  let ssXY = 0;
  let ssYY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xValues[i] - xMean;
    const dy = yValues[i] - yMean;
    ssXX += dx * dx;
    ssXY += dx * dy;
    ssYY += dy * dy;
  }
  if (ssXX === 0) {
    return null;
  }
  const slope = ssXY / ssXX;
  const intercept = yMean - (slope * xMean);
  const rSquared = ssYY === 0 ? 1 : ((ssXY * ssXY) / (ssXX * ssYY));
  return { slope, intercept, rSquared };
}

function normalizeIupacPatternForToolbox(raw) {
  const pattern = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!pattern) {
    return 'NGG';
  }
  return [...pattern].map((base) => (TOOLBOX_IUPAC_BASE_MAP[base] ? base : 'N')).join('');
}

function reverseComplementIupacForToolbox(pattern) {
  return [...String(pattern || '').toUpperCase()]
    .reverse()
    .map((base) => TOOLBOX_IUPAC_COMPLEMENT_MAP[base] || 'N')
    .join('');
}

function matchesIupacPatternForToolbox(sequence, pattern) {
  if (sequence.length !== pattern.length) {
    return false;
  }
  for (let i = 0; i < sequence.length; i += 1) {
    const base = sequence[i];
    const allowed = TOOLBOX_IUPAC_BASE_MAP[pattern[i]] || 'ACGT';
    if (!allowed.includes(base)) {
      return false;
    }
  }
  return true;
}

function parseCrisprTargetsTextForToolbox(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return [];
  }

  const out = [];
  const pushTarget = (name, sequenceText) => {
    const sequence = String(sequenceText || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .replace(/U/g, 'T')
      .replace(/[^ACGT]/g, 'N');
    if (sequence.length < 18) {
      return;
    }
    out.push({
      id: `target-${out.length + 1}`,
      name: cleanText(name, 80) || `Target ${out.length + 1}`,
      sequence
    });
  };

  if (/^\s*>/m.test(raw)) {
    const lines = raw.split(/\r?\n/);
    let currentName = '';
    let currentSequenceLines = [];
    const flush = () => {
      if (!currentSequenceLines.length) {
        return;
      }
      pushTarget(currentName || `Target ${out.length + 1}`, currentSequenceLines.join(''));
      currentSequenceLines = [];
    };
    lines.forEach((line) => {
      if (/^\s*>/.test(line)) {
        flush();
        currentName = line.replace(/^\s*>\s*/, '').trim();
      } else if (line.trim()) {
        currentSequenceLines.push(line.trim());
      }
    });
    flush();
    return out;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    lines.forEach((line) => pushTarget(`Target ${out.length + 1}`, line));
    if (out.length) {
      return out;
    }
  }
  pushTarget('Target 1', raw);
  return out;
}

function collectCrisprPamSitesForToolbox(target, guideLength, pamPatternRaw) {
  const sequence = String(target.sequence || '').toUpperCase();
  const pamPattern = normalizeIupacPatternForToolbox(pamPatternRaw);
  const pamLength = pamPattern.length;
  const reversePamPattern = reverseComplementIupacForToolbox(pamPattern);
  const windowSize = guideLength + pamLength;
  const sites = [];

  for (let i = 0; i + windowSize <= sequence.length; i += 1) {
    const guideForward = sequence.slice(i, i + guideLength);
    const pamForward = sequence.slice(i + guideLength, i + windowSize);
    if (/^[ACGT]+$/.test(guideForward) && matchesIupacPatternForToolbox(pamForward, pamPattern)) {
      sites.push({
        key: `${target.id}|+|${i + 1}`,
        target_id: target.id,
        target_name: target.name,
        strand: '+',
        start: i + 1,
        end: i + guideLength,
        guide_sequence: guideForward,
        pam_sequence: pamForward
      });
    }

    const pamReverse = sequence.slice(i, i + pamLength);
    const guideReverseWindow = sequence.slice(i + pamLength, i + windowSize);
    if (/^[ACGT]+$/.test(guideReverseWindow) && matchesIupacPatternForToolbox(pamReverse, reversePamPattern)) {
      sites.push({
        key: `${target.id}|-|${i + pamLength + 1}`,
        target_id: target.id,
        target_name: target.name,
        strand: '-',
        start: i + pamLength + 1,
        end: i + windowSize,
        guide_sequence: reverseComplementDnaForToolbox(guideReverseWindow),
        pam_sequence: reverseComplementDnaForToolbox(pamReverse)
      });
    }
  }

  return sites;
}

function countMismatchesForToolbox(left, right, maxMismatch = Infinity) {
  if (left.length !== right.length) {
    return maxMismatch + 1;
  }
  let mismatches = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      mismatches += 1;
      if (mismatches > maxMismatch) {
        return mismatches;
      }
    }
  }
  return mismatches;
}

function calculateGcPercentForToolbox(sequence) {
  if (!sequence.length) {
    return 0;
  }
  const counts = countNucleotideResidues(sequence);
  return (((counts.G || 0) + (counts.C || 0)) / sequence.length) * 100;
}

function scoreCrisprOnTargetForToolbox(guideSequence) {
  if (!guideSequence.length) {
    return 0;
  }
  const gcPercent = calculateGcPercentForToolbox(guideSequence);
  const seed = guideSequence.slice(Math.max(0, guideSequence.length - 10));
  const seedGc = calculateGcPercentForToolbox(seed);
  let score = 70 - (Math.abs(gcPercent - 52) * 1.25);

  if (guideSequence.startsWith('G')) {
    score += 4.5;
  }
  if (guideSequence.endsWith('GG')) {
    score += 2;
  }
  if (/TTTT/.test(guideSequence)) {
    score -= 22;
  }
  if (/(AAAAA|CCCCC|GGGGG|TTTTT)/.test(guideSequence)) {
    score -= 12;
  }
  if (seedGc < 35 || seedGc > 82) {
    score -= 6;
  } else {
    score += 3;
  }
  if (!/^[ACGT]+$/.test(guideSequence)) {
    score -= 30;
  }
  return clamp(score, 0, 100);
}

function computeCrisprOffTargetStatsForToolbox(candidate, backgroundSites, genomeMultiplier = 1) {
  const mismatchCounts = { exact: 0, mismatch1: 0, mismatch2: 0, mismatch3: 0 };
  backgroundSites.forEach((site) => {
    if (site.key === candidate.key) {
      return;
    }
    const mismatches = countMismatchesForToolbox(candidate.guide_sequence, site.guide_sequence, 3);
    if (mismatches > 3) {
      return;
    }
    if (mismatches === 0) {
      mismatchCounts.exact += 1;
    } else if (mismatches === 1) {
      mismatchCounts.mismatch1 += 1;
    } else if (mismatches === 2) {
      mismatchCounts.mismatch2 += 1;
    } else {
      mismatchCounts.mismatch3 += 1;
    }
  });
  const weightedRisk =
    (mismatchCounts.exact * 1.25) +
    (mismatchCounts.mismatch1 * 0.46) +
    (mismatchCounts.mismatch2 * 0.16) +
    (mismatchCounts.mismatch3 * 0.05);
  const offTargetRate = clamp(weightedRisk * 14.5 * genomeMultiplier, 0, 99.9);
  const specificityScore = clamp(100 - offTargetRate, 0, 100);
  return {
    mismatch_counts: mismatchCounts,
    off_target_rate: offTargetRate,
    specificity_score: specificityScore
  };
}

function splitRestrictionSitesForToolbox(rawSites) {
  if (Array.isArray(rawSites)) {
    return rawSites
      .map((value) => String(value || '').toUpperCase().replace(/U/g, 'T').replace(/[^ACGT]/g, ''))
      .filter((value) => value.length >= 3);
  }
  return String(rawSites || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .split(/[\s,;|]+/)
    .map((token) => token.trim())
    .filter((token) => /^[ACGT]{3,}$/.test(token));
}

function anyRestrictedSiteIntroducedForToolbox(dna, restrictionSites) {
  if (!restrictionSites.length) {
    return false;
  }
  return restrictionSites.some((site) => dna.includes(site) || dna.includes(reverseComplementDnaForToolbox(site)));
}

function reverseTranslateProteinForToolbox(proteinInput, options = {}) {
  const appendStopCodon = options.appendStopCodon === true;
  const restrictionSites = splitRestrictionSitesForToolbox(options.restrictionSites);
  const cleaned = cleanProteinSequenceForToolbox(proteinInput, true);
  const protein = appendStopCodon && cleaned && !cleaned.endsWith('*')
    ? `${cleaned}*`
    : cleaned;
  if (!protein) {
    return {
      ok: false,
      reason: 'empty_protein',
      message: 'Enter a protein sequence to reverse translate.',
      protein: '',
      dna: '',
      codons: []
    };
  }

  const unsupported = [...new Set([...protein].filter((residue) => !TOOLBOX_AA_TO_CODONS[residue]))];
  if (unsupported.length) {
    return {
      ok: false,
      reason: 'unsupported_residue',
      message: `Unsupported residues: ${unsupported.join(', ')}`,
      unsupported_residues: unsupported,
      protein,
      dna: '',
      codons: []
    };
  }

  let dna = '';
  const codons = [];
  for (let i = 0; i < protein.length; i += 1) {
    const residue = protein[i];
    const optionsForResidue = TOOLBOX_AA_TO_CODONS[residue] || [];
    let picked = optionsForResidue[0] || '';
    for (const candidate of optionsForResidue) {
      const next = `${dna}${candidate}`;
      if (!anyRestrictedSiteIntroducedForToolbox(next, restrictionSites)) {
        picked = candidate;
        break;
      }
    }
    dna += picked;
    codons.push(picked);
  }

  if (anyRestrictedSiteIntroducedForToolbox(dna, restrictionSites)) {
    return {
      ok: false,
      reason: 'restriction_conflict',
      message: 'Unable to avoid all restricted motifs with available codon choices.',
      protein,
      dna,
      codons,
      restriction_sites: restrictionSites
    };
  }

  const counts = countNucleotideResidues(dna);
  const gcContent = dna.length ? (((counts.G || 0) + (counts.C || 0)) / dna.length) * 100 : 0;
  return {
    ok: true,
    protein,
    dna,
    codons,
    aa_length: protein.length,
    nt_length: dna.length,
    gc_content: gcContent,
    restriction_sites: restrictionSites
  };
}

module.exports = {
  toolboxConcentrationToM,
  toolboxConcentrationFromM,
  toolboxVolumeToL,
  toolboxVolumeFromL,
  toolboxMassToG,
  toolboxMassFromG,
  cleanNucleotideSequenceForToolbox,
  countNucleotideResidues,
  translateDnaSequenceForToolbox,
  cleanProteinSequenceForToolbox,
  calculatePeptideStatsForToolbox,
  oligoMolecularWeightForToolbox,
  oligoExtinctionForToolbox,
  oligoTmForToolbox,
  linearRegressionForToolbox,
  parseCrisprTargetsTextForToolbox,
  collectCrisprPamSitesForToolbox,
  calculateGcPercentForToolbox,
  scoreCrisprOnTargetForToolbox,
  computeCrisprOffTargetStatsForToolbox,
  reverseTranslateProteinForToolbox
};
