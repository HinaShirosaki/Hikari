import { clampNumber } from './common.js';
import { nucleotideCounts, reverseComplementDna } from './sequence.js';

const IUPAC_BASE_MAP = Object.freeze({
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

const IUPAC_COMPLEMENT_MAP = Object.freeze({
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

export const CRISPR_REFERENCE_GENOMES = Object.freeze([
  {
    id: 'human-hg38',
    label: 'Human (GRCh38 / hg38)',
    offTargetMultiplier: 1.35,
    note: 'Large and repetitive genome. Off-target estimates are scaled conservatively.'
  },
  {
    id: 'mouse-mm39',
    label: 'Mouse (GRCm39 / mm39)',
    offTargetMultiplier: 1.2,
    note: 'Mammalian-scale genome with moderate repeat burden.'
  },
  {
    id: 'zebrafish-gz11',
    label: 'Zebrafish (GRCz11)',
    offTargetMultiplier: 1.05,
    note: 'Intermediate genome size with common duplicated regions.'
  },
  {
    id: 'yeast-r64',
    label: 'Yeast (S288C / R64)',
    offTargetMultiplier: 0.72,
    note: 'Compact genome. Off-target rates are typically lower.'
  },
  {
    id: 'ecoli-k12',
    label: 'E. coli (K-12 MG1655)',
    offTargetMultiplier: 0.58,
    note: 'Small bacterial genome with reduced off-target search space.'
  },
  {
    id: 'custom',
    label: 'Custom / User-supplied',
    offTargetMultiplier: 1,
    note: 'No organism-specific scaling. Only submitted targets are evaluated directly.'
  }
]);

function normalizeDnaInput(raw, preserveUnknown = false) {
  const letters = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .replace(/U/g, 'T');
  if (!preserveUnknown) {
    return letters.replace(/[^ACGT]/g, '');
  }
  return letters.replace(/[^ACGT]/g, 'N');
}

export function normalizeIupacPattern(raw) {
  const pattern = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!pattern) {
    return 'NGG';
  }
  return [...pattern]
    .map((base) => (IUPAC_BASE_MAP[base] ? base : 'N'))
    .join('');
}

function reverseComplementIupac(pattern) {
  return [...String(pattern || '').toUpperCase()]
    .reverse()
    .map((base) => IUPAC_COMPLEMENT_MAP[base] || 'N')
    .join('');
}

export function matchesIupacPattern(sequence, pattern) {
  if (sequence.length !== pattern.length) {
    return false;
  }
  for (let i = 0; i < sequence.length; i += 1) {
    const base = sequence[i];
    const allowed = IUPAC_BASE_MAP[pattern[i]] || 'ACGT';
    if (!allowed.includes(base)) {
      return false;
    }
  }
  return true;
}

function countSequenceMismatches(left, right, maxMismatch = Infinity) {
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

function calculateGcPercent(sequence) {
  if (!sequence.length) {
    return 0;
  }
  const counts = nucleotideCounts(sequence);
  const gc = (counts.G || 0) + (counts.C || 0);
  return (gc / sequence.length) * 100;
}

function scoreCrisprOnTarget(guideSequence) {
  if (!guideSequence.length) {
    return 0;
  }

  const gcPercent = calculateGcPercent(guideSequence);
  const seed = guideSequence.slice(Math.max(0, guideSequence.length - 10));
  const seedGc = calculateGcPercent(seed);
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

  return clampNumber(score, 0, 100, 0);
}

function sanitizeCrisprTargetName(rawName, fallbackName) {
  const clean = String(rawName || '')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
  if (!clean) {
    return fallbackName;
  }
  return clean.slice(0, 80);
}

function buildCrisprTargetEntry(name, sequenceText, index) {
  const sequence = normalizeDnaInput(sequenceText, true);
  if (!sequence.length) {
    return null;
  }
  return {
    id: `target-${index + 1}`,
    name: sanitizeCrisprTargetName(name, `Target ${index + 1}`),
    sequence
  };
}

function parseCrisprLineTarget(line, index) {
  const namedMatch = String(line).match(/^([^:|]{1,80})\s*[:|]\s*([A-Za-z\-\s]+)$/);
  if (!namedMatch) {
    return null;
  }
  return buildCrisprTargetEntry(namedMatch[1], namedMatch[2], index);
}

export function parseCrisprTargetsInput(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return [];
  }

  const parsed = [];
  const pushTarget = (name, sequenceText) => {
    const entry = buildCrisprTargetEntry(name, sequenceText, parsed.length);
    if (entry) {
      parsed.push(entry);
    }
  };

  if (/^\s*>/m.test(raw)) {
    const lines = raw.split(/\r?\n/);
    let currentName = '';
    let currentSequenceLines = [];

    const flush = () => {
      if (!currentSequenceLines.length) {
        return;
      }
      pushTarget(currentName || `Target ${parsed.length + 1}`, currentSequenceLines.join(''));
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
    return parsed;
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const namedTargets = lines
    .map((line, index) => parseCrisprLineTarget(line, index))
    .filter(Boolean);
  if (namedTargets.length) {
    return namedTargets.map((entry, index) => ({ ...entry, id: `target-${index + 1}` }));
  }

  const dnaLikeLines = lines.filter((line) => normalizeDnaInput(line, true).length >= 18);
  if (dnaLikeLines.length >= 2 && dnaLikeLines.length === lines.length) {
    dnaLikeLines.forEach((line) => pushTarget(`Target ${parsed.length + 1}`, line));
    return parsed;
  }

  pushTarget('Target 1', raw);
  return parsed;
}

export function collectCrisprPamSites(target, guideLength, pamPattern) {
  const sequence = String(target.sequence || '').toUpperCase();
  const pamLength = pamPattern.length;
  const reversePamPattern = reverseComplementIupac(pamPattern);
  const windowSize = guideLength + pamLength;
  const sites = [];

  for (let i = 0; i + windowSize <= sequence.length; i += 1) {
    const guideForward = sequence.slice(i, i + guideLength);
    const pamForward = sequence.slice(i + guideLength, i + windowSize);
    if (/^[ACGT]+$/.test(guideForward) && matchesIupacPattern(pamForward, pamPattern)) {
      sites.push({
        key: `${target.id}|+|${i + 1}`,
        targetId: target.id,
        targetName: target.name,
        strand: '+',
        start: i + 1,
        end: i + guideLength,
        guideSequence: guideForward,
        pamSequence: pamForward
      });
    }

    const pamReverse = sequence.slice(i, i + pamLength);
    const guideReverseWindow = sequence.slice(i + pamLength, i + windowSize);
    if (/^[ACGT]+$/.test(guideReverseWindow) && matchesIupacPattern(pamReverse, reversePamPattern)) {
      sites.push({
        key: `${target.id}|-|${i + pamLength + 1}`,
        targetId: target.id,
        targetName: target.name,
        strand: '-',
        start: i + pamLength + 1,
        end: i + windowSize,
        guideSequence: reverseComplementDna(guideReverseWindow),
        pamSequence: reverseComplementDna(pamReverse)
      });
    }
  }

  return sites;
}

function collectCrisprPamSitesFromTargets(targets, guideLength, pamPattern) {
  const allSites = [];
  targets.forEach((target) => {
    allSites.push(...collectCrisprPamSites(target, guideLength, pamPattern));
  });
  return allSites;
}

export function computeCrisprOffTargetStats(candidate, backgroundSites, genomeMultiplier = 1) {
  const mismatchCounts = {
    exact: 0,
    mismatch1: 0,
    mismatch2: 0,
    mismatch3: 0
  };

  backgroundSites.forEach((site) => {
    if (site.key === candidate.key) {
      return;
    }

    const mismatches = countSequenceMismatches(candidate.guideSequence, site.guideSequence, 3);
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
  const offTargetRate = clampNumber(weightedRisk * 14.5 * genomeMultiplier, 0, 99.9, 0);
  const specificityScore = clampNumber(100 - offTargetRate, 0, 100, 100);

  return {
    mismatchCounts,
    offTargetRate,
    specificityScore
  };
}

export function designCrisprGuides({
  selectedTargets,
  backgroundTargets,
  guideLength,
  pamPattern,
  minGc,
  maxGc,
  topCount,
  genomeMultiplier
}) {
  const selectedSites = collectCrisprPamSitesFromTargets(selectedTargets, guideLength, pamPattern);
  const candidates = selectedSites
    .map((site) => {
      const gcPercent = calculateGcPercent(site.guideSequence);
      const notes = [];
      if (/TTTT/.test(site.guideSequence)) {
        notes.push('poly-T motif');
      }
      if (/(AAAAA|CCCCC|GGGGG|TTTTT)/.test(site.guideSequence)) {
        notes.push('homopolymer');
      }

      return {
        ...site,
        gcPercent,
        onTargetScore: scoreCrisprOnTarget(site.guideSequence),
        notes
      };
    })
    .filter((candidate) => candidate.gcPercent >= minGc && candidate.gcPercent <= maxGc);

  if (!candidates.length) {
    return {
      candidates: [],
      totalPamMatches: selectedSites.length,
      filteredCandidateCount: 0,
      evaluatedCandidateCount: 0,
      backgroundSiteCount: 0,
      scannedBackgroundSiteCount: 0,
      truncatedBackground: false,
      truncatedCandidates: false
    };
  }

  candidates.sort((left, right) => (
    (right.onTargetScore - left.onTargetScore) ||
    (right.gcPercent - left.gcPercent)
  ));

  const maxBackgroundSites = 15000;
  const maxEvaluatedCandidates = Math.min(
    candidates.length,
    Math.max(topCount * 4, 120),
    320
  );
  const backgroundSites = collectCrisprPamSitesFromTargets(backgroundTargets, guideLength, pamPattern);
  const scannedBackgroundSites = backgroundSites.slice(0, maxBackgroundSites);

  const scoredCandidates = candidates
    .slice(0, maxEvaluatedCandidates)
    .map((candidate) => {
      const offTarget = computeCrisprOffTargetStats(candidate, scannedBackgroundSites, genomeMultiplier);
      const totalScore = (candidate.onTargetScore * 0.62) + (offTarget.specificityScore * 0.38);
      return {
        ...candidate,
        ...offTarget,
        totalScore
      };
    })
    .sort((left, right) => (
      (right.totalScore - left.totalScore) ||
      (right.onTargetScore - left.onTargetScore) ||
      (right.specificityScore - left.specificityScore)
    ));

  return {
    candidates: scoredCandidates.slice(0, topCount),
    totalPamMatches: selectedSites.length,
    filteredCandidateCount: candidates.length,
    evaluatedCandidateCount: scoredCandidates.length,
    backgroundSiteCount: backgroundSites.length,
    scannedBackgroundSiteCount: scannedBackgroundSites.length,
    truncatedBackground: backgroundSites.length > scannedBackgroundSites.length,
    truncatedCandidates: candidates.length > scoredCandidates.length
  };
}
