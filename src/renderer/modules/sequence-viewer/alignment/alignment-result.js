import { normalizeTopology } from '../shared.js';
import { normalizeCircularDifferenceRange, normalizeCircularRange } from './coordinate-ranges.js';

function buildAlignmentResultFromColumns(columns, queryLength, referenceLength, topology, options = {}) {
  const safeTopology = normalizeTopology(topology);
  const isCircular = safeTopology === 'circular';
  const firstReferenceOffset = columns.find((column) => Number.isFinite(column.referenceOffset))?.referenceOffset ?? 0;
  const firstQueryOffset = columns.find((column) => Number.isFinite(column.queryOffset))?.queryOffset ?? 0;
  let referenceCursor = firstReferenceOffset;
  let queryCursor = firstQueryOffset;
  let mismatchCount = 0;
  let insertionCount = 0;
  let deletionCount = 0;
  let matchCount = 0;
  let coveredQueryBases = 0;
  let firstConsumedReference = null;
  let lastConsumedReference = null;
  const markers = [];
  const alignedReference = [];
  const alignedQuery = [];
  const differences = [];
  let activeDifference = null;

  const flushDifference = () => {
    if (!activeDifference) {
      return;
    }

    if (isCircular) {
      const normalizedRange = normalizeCircularDifferenceRange(
        activeDifference.referenceStart,
        activeDifference.referenceEnd,
        referenceLength
      );
      activeDifference.referenceStart = normalizedRange.start;
      activeDifference.referenceEnd = normalizedRange.end;
    }

    differences.push(activeDifference);
    activeDifference = null;
  };

  columns.forEach((column) => {
    const referenceBase = String(column.referenceBase || '-');
    const queryBase = String(column.queryBase || '-');
    const referenceStart = referenceCursor;
    const queryStart = queryCursor;
    const consumesReference = referenceBase !== '-';
    const consumesQuery = queryBase !== '-';

    alignedReference.push(referenceBase);
    alignedQuery.push(queryBase);

    if (consumesReference) {
      if (!Number.isFinite(firstConsumedReference)) {
        firstConsumedReference = referenceStart;
      }
      referenceCursor += 1;
      lastConsumedReference = referenceCursor;
    }
    if (consumesQuery) {
      queryCursor += 1;
    }

    const referenceEnd = referenceCursor;
    const queryEnd = queryCursor;

    if (consumesReference && consumesQuery) {
      coveredQueryBases += 1;
    }

    let marker = ' ';
    let differenceType = '';
    if (consumesReference && consumesQuery && referenceBase === queryBase) {
      matchCount += 1;
      marker = '|';
    } else if (consumesReference && consumesQuery) {
      mismatchCount += 1;
      marker = '.';
      differenceType = 'mismatch';
    } else if (!consumesReference && consumesQuery) {
      insertionCount += 1;
      differenceType = 'insertion';
    } else if (consumesReference && !consumesQuery) {
      deletionCount += 1;
      differenceType = 'deletion';
    }
    markers.push(marker);

    if (!differenceType) {
      flushDifference();
      return;
    }

    if (
      activeDifference
      && activeDifference.type === differenceType
      && activeDifference.referenceEnd === referenceStart
      && activeDifference.queryEnd === queryStart
    ) {
      activeDifference.referenceEnd = referenceEnd;
      activeDifference.queryEnd = queryEnd;
      activeDifference.referenceBases += consumesReference ? referenceBase : '';
      activeDifference.queryBases += consumesQuery ? queryBase : '';
      return;
    }

    flushDifference();
    activeDifference = {
      type: differenceType,
      referenceStart,
      referenceEnd,
      queryStart,
      queryEnd,
      referenceBases: consumesReference ? referenceBase : '',
      queryBases: consumesQuery ? queryBase : ''
    };
  });

  flushDifference();

  const coveredBases = Math.max(0, coveredQueryBases);
  const safeQueryLength = Math.max(1, queryLength);
  const identityPercent = coveredBases > 0
    ? (matchCount / coveredBases) * 100
    : 0;
  const queryCoveragePercent = (coveredBases / safeQueryLength) * 100;

  let referenceSpan = {
    start: 0,
    end: 0,
    wraps: false
  };

  if (Number.isFinite(firstConsumedReference) && Number.isFinite(lastConsumedReference)) {
    if (isCircular) {
      const normalized = normalizeCircularRange(firstConsumedReference, lastConsumedReference, referenceLength);
      if (!normalized) {
        return null;
      }
      referenceSpan = normalized;
    } else {
      referenceSpan = {
        start: firstConsumedReference,
        end: lastConsumedReference,
        wraps: false
      };
    }
  }

  return {
    score: Number(options.score) || 0,
    coveredQueryBases: coveredBases,
    identityPercent,
    queryCoveragePercent,
    mismatchCount,
    insertionCount,
    deletionCount,
    referenceSpan,
    alignedReference: alignedReference.join(''),
    alignedMarkers: markers.join(''),
    alignedQuery: alignedQuery.join(''),
    differences
  };
}

function compareAlignmentResults(left, right) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  if (Math.abs(right.identityPercent - left.identityPercent) > 1e-9) {
    return right.identityPercent - left.identityPercent;
  }
  if (right.coveredQueryBases !== left.coveredQueryBases) {
    return right.coveredQueryBases - left.coveredQueryBases;
  }
  if (left.orientation !== right.orientation) {
    return left.orientation === 'forward' ? -1 : 1;
  }
  return 0;
}

export {
  buildAlignmentResultFromColumns,
  compareAlignmentResults
};
