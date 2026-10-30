import { reverseComplementIupac } from './shared.js';
import { buildAlignmentResultFromColumns, compareAlignmentResults } from './alignment/alignment-result.js';
import { buildCandidateWindows, normalizeAlignmentRecord } from './alignment/candidate-windows.js';
import { runSemiGlobalAffineAlignment } from './alignment/path-scoring.js';

function alignOrientationAgainstReference(referenceRecord, queryRecord, orientation, options = {}) {
  const safeReference = normalizeAlignmentRecord(referenceRecord, 'reference');
  const safeQuery = normalizeAlignmentRecord(queryRecord, 'query');
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
      referenceName: safeReference.name,
      queryName: safeQuery.name,
      referenceFormat: safeReference.sourceFormat,
      queryFormat: safeQuery.sourceFormat,
      orientation,
      score: aligned.score,
      identityPercent: summary.identityPercent,
      queryCoveragePercent: summary.queryCoveragePercent,
      referenceSpan: summary.referenceSpan,
      mismatchCount: summary.mismatchCount,
      insertionCount: summary.insertionCount,
      deletionCount: summary.deletionCount,
      alignedReference: summary.alignedReference,
      alignedMarkers: summary.alignedMarkers,
      alignedQuery: summary.alignedQuery,
      differences: summary.differences,
      coveredQueryBases: summary.coveredQueryBases,
      anchorCount: window.anchorCount
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

  const candidates = [
    alignOrientationAgainstReference(safeReference, safeQuery, 'forward', options),
    alignOrientationAgainstReference(safeReference, safeQuery, 'reverse', options)
  ].filter(Boolean);

  if (!candidates.length) {
    throw new Error('No sequencing alignment could be generated for the selected inputs.');
  }

  candidates.sort(compareAlignmentResults);
  const best = candidates[0];
  return {
    referenceName: best.referenceName,
    queryName: best.queryName,
    referenceFormat: best.referenceFormat,
    queryFormat: best.queryFormat,
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
