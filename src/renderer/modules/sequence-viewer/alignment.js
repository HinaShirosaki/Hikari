import { reverseComplementIupac } from './shared.js';
import { buildAlignmentResultFromColumns, compareAlignmentResults } from './alignment/alignment-result.js';
import { buildCandidateWindows, normalizeAlignmentRecord } from './alignment/candidate-windows.js';
import { DEFAULT_MATCH_SCORE } from './alignment/constants.js';
import { runSemiGlobalAffineAlignment } from './alignment/path-scoring.js';

function findExactAlignment(reference, query, options) {
  if (query.sequence.length > reference.sequence.length || !/^[ACGT]+$/.test(query.sequence)
    || options.matchScore !== undefined || options.mismatchScore !== undefined
    || options.gapOpenScore !== undefined || options.gapExtendScore !== undefined
    || options.windowPadding !== undefined) {
    return null;
  }

  const searchSequence = reference.topology === 'circular' ? reference.sequence.repeat(2) : reference.sequence;
  let orientation = 'forward';
  let sequence = query.sequence;
  let start = searchSequence.indexOf(sequence);
  if (start < 0) {
    orientation = 'reverse';
    sequence = reverseComplementIupac(sequence);
    start = searchSequence.indexOf(sequence);
  }
  if (start < 0) {
    return null;
  }

  // A full exact match reaches the maximum score under the default penalties.
  // It also wins every k-mer vote, so the first occurrence and forward tie
  // preference agree with the seeded search.
  const columns = Array.from(sequence, (base, queryOffset) => ({
    referenceBase: base,
    queryBase: base,
    referenceOffset: start + queryOffset,
    queryOffset
  }));
  const summary = buildAlignmentResultFromColumns(
    columns, sequence.length, reference.sequence.length, reference.topology,
    { score: sequence.length * DEFAULT_MATCH_SCORE }
  );
  return { ...summary, orientation };
}

function alignOrientationAgainstReference(safeReference, safeQuery, orientation, options) {
  const orientedQuerySequence = orientation === 'reverse'
    ? reverseComplementIupac(safeQuery.sequence)
    : safeQuery.sequence;
  const searchSpace = buildCandidateWindows(
    safeReference.sequence,
    orientedQuerySequence,
    safeReference.topology,
    options
  );

  let best = null;
  searchSpace.windows.forEach((window) => {
    const referenceWindow = searchSpace.searchSequence.slice(window.start, window.end);
    const aligned = runSemiGlobalAffineAlignment(referenceWindow, orientedQuerySequence, options);
    if (!aligned?.columns?.length) {
      return;
    }

    const absoluteColumns = aligned.columns.map((column) => ({
      ...column,
      referenceOffset: Number.isFinite(column.referenceOffset)
        ? window.start + column.referenceOffset
        : null
    }));

    const summary = buildAlignmentResultFromColumns(
      absoluteColumns,
      orientedQuerySequence.length,
      safeReference.sequence.length,
      safeReference.topology,
      { score: aligned.score }
    );

    if (!summary) {
      return;
    }

    const candidate = {
      ...summary,
      orientation,
      score: aligned.score
    };

    if (compareAlignmentResults(best, candidate) > 0) {
      best = candidate;
    }
  });

  return best;
}

export function alignSequenceToReference(referenceRecord, queryRecord, options = {}) {
  const safeReference = normalizeAlignmentRecord(referenceRecord, 'reference');
  const safeQuery = normalizeAlignmentRecord(queryRecord, 'query');
  if (!safeReference.sequence.length || !safeQuery.sequence.length) {
    throw new Error('Reference and query sequences are both required.');
  }

  let best = findExactAlignment(safeReference, safeQuery, options);
  if (!best) {
    const candidates = [
      alignOrientationAgainstReference(safeReference, safeQuery, 'forward', options),
      alignOrientationAgainstReference(safeReference, safeQuery, 'reverse', options)
    ].filter(Boolean);
    candidates.sort(compareAlignmentResults);
    [best] = candidates;
  }
  if (!best) {
    throw new Error('No sequencing alignment could be generated for the selected inputs.');
  }

  return {
    referenceName: safeReference.name,
    queryName: safeQuery.name,
    referenceFormat: safeReference.sourceFormat,
    queryFormat: safeQuery.sourceFormat,
    orientation: best.orientation,
    score: best.score,
    identityPercent: best.identityPercent,
    queryCoveragePercent: best.queryCoveragePercent,
    referenceSpan: best.referenceSpan,
    mismatchCount: best.mismatchCount,
    insertionCount: best.insertionCount,
    deletionCount: best.deletionCount,
    alignedReference: best.alignedReference,
    alignedMarkers: best.alignedMarkers,
    alignedQuery: best.alignedQuery,
    differences: best.differences
  };
}
