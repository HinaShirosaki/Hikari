// CRISPR guide-design helpers.
//
// Responsibilities:
// - normalize CRISPR target input from free text, FASTA, or named sequence lists
// - scan sequences for PAM-compatible guide windows on both strands
// - estimate simple on-target scoring heuristics
// - count near-matching guides among the submitted sequences (not a genome-wide off-target search)
// - rank and return the best candidate guides
import { clampNumber } from '../../../lib/numbers.js';
import { nucleotideCounts, reverseComplementDna } from './sequence.js';

// IUPAC ambiguity code lookup used for PAM matching and normalization.
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

// Complement mapping for IUPAC ambiguity codes when scanning the reverse strand.
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

// Normalize arbitrary DNA/RNA-like text into uppercase DNA letters, optionally preserving unknown bases as N.
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

// Normalize a user-supplied PAM string into valid IUPAC symbols, defaulting to NGG.
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

// Reverse-complement an IUPAC pattern so reverse-strand PAMs can be matched directly.
function reverseComplementIupac(pattern) {
  return [...String(pattern || '').toUpperCase()]
    .reverse()
    .map((base) => IUPAC_COMPLEMENT_MAP[base] || 'N')
    .join('');
}

// Check whether a concrete DNA sequence satisfies an IUPAC ambiguity pattern position by position.
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

// Count mismatches between two equal-length guide sequences, stopping early after the requested threshold.
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

// Calculate GC percentage for one guide or sequence window.
function calculateGcPercent(sequence) {
  if (!sequence.length) {
    return 0;
  }
  const counts = nucleotideCounts(sequence);
  const gc = (counts.G || 0) + (counts.C || 0);
  return (gc / sequence.length) * 100;
}

// Apply a lightweight heuristic on-target score based on GC balance and common sequence motifs.
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

// Clean a user-supplied target name into a compact display label.
function sanitizeCrisprTargetName(rawName, fallbackName) {
  const clean = String(rawName || '')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
  if (!clean) {
    return fallbackName;
  }
  return clean.slice(0, 80);
}

// Build one normalized target entry from a name/sequence pair.
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

// Match a single named target line in formats like "name: sequence" or "name | sequence".
function matchNamedTargetLine(line) {
  const namedMatch = String(line).match(/^([^:|]{1,80})\s*[:|]\s*([A-Za-z\-\s]+)$/);
  if (!namedMatch) {
    return null;
  }
  return { name: namedMatch[1], sequenceText: namedMatch[2] };
}

// Detect a single sequence wrapped across fixed-width lines, as opposed to a list of separate targets.
// ponytail: requires 3+ lines because two lines carry no width evidence either way. When in doubt we
// split, since fusing two targets invents guides that span a junction present in neither molecule.
function isWrappedSequenceBlock(lines) {
  if (lines.length < 3) {
    return false;
  }
  const width = lines[0].length;
  return lines.slice(0, -1).every((line) => line.length === width)
    && lines[lines.length - 1].length <= width;
}

// Parse CRISPR targets from FASTA, named lines, multi-line sequence lists, or one raw sequence block.
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

  // Only treat this as a named list when every line is named; otherwise the unnamed lines would be dropped.
  const namedLines = lines.map(matchNamedTargetLine);
  if (namedLines.every(Boolean)) {
    namedLines.forEach((named) => pushTarget(named.name, named.sequenceText));
    return parsed;
  }

  if (lines.length === 1 || isWrappedSequenceBlock(lines)) {
    pushTarget('Target 1', lines.join(''));
    return parsed;
  }

  lines.forEach((line) => {
    const named = matchNamedTargetLine(line);
    pushTarget(named?.name || `Target ${parsed.length + 1}`, named?.sequenceText || line);
  });
  return parsed;
}

// Scan one target sequence for guide-plus-PAM windows on both forward and reverse strands.
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

// Collect PAM-compatible candidate sites across a list of targets.
function collectCrisprPamSitesFromTargets(targets, guideLength, pamPattern) {
  // Appended one at a time: spreading blows the argument limit past ~130k sites (a >1.4 Mb target).
  const allSites = [];
  targets.forEach((target) => {
    collectCrisprPamSites(target, guideLength, pamPattern).forEach((site) => allSites.push(site));
  });
  return allSites;
}

// Count near-matches for one guide among the submitted sequences only. This is not a genome-wide
// search: nothing here reads a reference genome, so a clean result means clean within what was pasted.
export function computeCrisprOffTargetStats(candidate, backgroundSites) {
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
  const offTargetRate = clampNumber(weightedRisk * 14.5, 0, 99.9, 0);
  const specificityScore = clampNumber(100 - offTargetRate, 0, 100, 100);

  return {
    mismatchCounts,
    offTargetRate,
    specificityScore
  };
}

// Flatten ranked guides into tab-separated rows that paste directly into a spreadsheet or order form.
export function buildCrisprGuideTsv(candidates) {
  const header = [
    'Rank', 'Target', 'Start', 'End', 'Strand', 'Guide', 'PAM', 'GC%',
    'OnTarget', 'OffTargetRate', 'Score', 'Mismatches0/1/2/3', 'Notes'
  ];
  // Tabs and newlines are the only characters that could break the row/column split.
  const cell = (value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
  const rows = (candidates || []).map((candidate, index) => {
    const counts = candidate.mismatchCounts || {};
    return [
      index + 1,
      cell(candidate.targetName),
      candidate.start,
      candidate.end,
      candidate.strand,
      candidate.guideSequence,
      candidate.pamSequence,
      candidate.gcPercent.toFixed(1),
      candidate.onTargetScore.toFixed(1),
      candidate.offTargetRate.toFixed(2),
      candidate.totalScore.toFixed(1),
      `${counts.exact}/${counts.mismatch1}/${counts.mismatch2}/${counts.mismatch3}`,
      cell((candidate.notes || []).join('; '))
    ].join('\t');
  });
  return [header.join('\t'), ...rows].join('\n');
}

// Main CRISPR guide-design entry point that filters, scores, and ranks candidate guides.
export function designCrisprGuides({
  selectedTargets,
  backgroundTargets,
  guideLength,
  pamPattern,
  minGc,
  maxGc,
  topCount
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
      // scoreCrisprOnTarget already rewards a leading G; say why, since U6 transcription needs one.
      if (!site.guideSequence.startsWith('G')) {
        notes.push('prepend G for U6');
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
      const offTarget = computeCrisprOffTargetStats(candidate, scannedBackgroundSites);
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
