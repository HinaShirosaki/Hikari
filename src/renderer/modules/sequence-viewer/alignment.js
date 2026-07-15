import {
  normalizeTopology,
  reverseComplementIupac
} from './shared.js';

const DEFAULT_MATCH_SCORE = 2;
const DEFAULT_MISMATCH_SCORE = -3;
const DEFAULT_GAP_OPEN_SCORE = -5;
const DEFAULT_GAP_EXTEND_SCORE = -2;
const DEFAULT_WINDOW_PADDING_BP = 80;
const DEFAULT_MAX_CANDIDATE_WINDOWS = 5;
const NEGATIVE_INFINITY_SCORE = -1e15;

const STATE_MATCH = 0;
const STATE_QUERY_GAP = 1;
const STATE_REFERENCE_GAP = 2;

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, numeric));
}

function normalizeAlignmentRecord(record, fallbackName) {
  const safeRecord = record && typeof record === 'object' ? record : {};
  const sequence = String(safeRecord.sequence || '').toUpperCase();
  if (!sequence) {
    throw new Error(`${fallbackName} record has no sequence.`);
  }

  return {
    name: String(safeRecord.name || fallbackName || 'record').trim() || fallbackName || 'record',
    sourceFormat: String(safeRecord.sourceFormat || 'unknown').trim() || 'unknown',
    topology: normalizeTopology(safeRecord.topology || 'linear'),
    sequence
  };
}

function isCanonicalDnaSegment(segment) {
  return /^[ACGT]+$/.test(String(segment || ''));
}

function buildKmerIndex(sequence, k) {
  const index = new Map();
  const length = Math.max(0, sequence.length - k + 1);
  for (let position = 0; position < length; position += 1) {
    const kmer = sequence.slice(position, position + k);
    if (!isCanonicalDnaSegment(kmer)) {
      continue;
    }
    if (!index.has(kmer)) {
      index.set(kmer, []);
    }
    index.get(kmer).push(position);
  }
  return index;
}

function collectOffsetBins(referenceSequence, querySequence, k) {
  const referenceIndex = buildKmerIndex(referenceSequence, k);
  const bins = new Map();
  const limit = Math.max(0, querySequence.length - k + 1);

  for (let queryPosition = 0; queryPosition < limit; queryPosition += 1) {
    const kmer = querySequence.slice(queryPosition, queryPosition + k);
    if (!isCanonicalDnaSegment(kmer)) {
      continue;
    }

    const referencePositions = referenceIndex.get(kmer);
    if (!referencePositions?.length) {
      continue;
    }

    referencePositions.forEach((referencePosition) => {
      const offset = referencePosition - queryPosition;
      bins.set(offset, (bins.get(offset) || 0) + 1);
    });
  }

  return [...bins.entries()]
    .map(([offset, count]) => ({ offset, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.offset - right.offset;
    });
}

function buildCandidateWindows(referenceSequence, querySequence, topology, options = {}) {
  const safeTopology = normalizeTopology(topology);
  const isCircular = safeTopology === 'circular';
  const queryLength = Math.max(0, querySequence.length);
  const searchSequence = isCircular ? `${referenceSequence}${referenceSequence}` : referenceSequence;
  const k = queryLength < 80 ? 6 : 8;
  const padding = Math.max(0, Number(options.windowPadding) || DEFAULT_WINDOW_PADDING_BP);
  const targetWindowLength = Math.max(queryLength, queryLength + (padding * 2));
  const topLimit = Math.max(1, Math.floor(Number(options.maxWindows) || DEFAULT_MAX_CANDIDATE_WINDOWS));

  const bins = collectOffsetBins(searchSequence, querySequence, k).slice(0, topLimit);
  const windows = [];
  const seen = new Set();

  const pushWindow = (start, end, anchorCount = 0) => {
    const safeStart = clamp(Math.floor(start), 0, Math.max(0, searchSequence.length));
    const safeEnd = clamp(Math.ceil(end), safeStart, Math.max(0, searchSequence.length));
    const key = `${safeStart}:${safeEnd}`;
    if (seen.has(key) || safeEnd <= safeStart) {
      return;
    }
    seen.add(key);
    windows.push({
      start: safeStart,
      end: safeEnd,
      anchorCount
    });
  };

  bins.forEach((bin) => {
    let windowStart = Math.floor(bin.offset - padding);
    let windowEnd = windowStart + targetWindowLength;

    if (windowStart < 0) {
      windowEnd = Math.min(searchSequence.length, windowEnd - windowStart);
      windowStart = 0;
    }
    if (windowEnd > searchSequence.length) {
      const overflow = windowEnd - searchSequence.length;
      windowStart = Math.max(0, windowStart - overflow);
      windowEnd = searchSequence.length;
    }

    pushWindow(windowStart, windowEnd, bin.count);
  });

  if (!windows.length) {
    pushWindow(0, searchSequence.length, 0);
  }

  return {
    k,
    searchSequence,
    windows
  };
}

function compareAlignmentPath(left, right) {
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

  const leftCovered = Math.max(0, Number(left.covered) || 0);
  const rightCovered = Math.max(0, Number(right.covered) || 0);
  const identityLeft = (Number(left.matches) || 0) * rightCovered;
  const identityRight = (Number(right.matches) || 0) * leftCovered;
  if (identityRight !== identityLeft) {
    return identityRight - identityLeft;
  }
  if (rightCovered !== leftCovered) {
    return rightCovered - leftCovered;
  }
  if ((right.matches || 0) !== (left.matches || 0)) {
    return (right.matches || 0) - (left.matches || 0);
  }
  return 0;
}

function chooseBestPath(candidates) {
  let best = candidates[0] || null;
  for (let index = 1; index < candidates.length; index += 1) {
    const current = candidates[index];
    if (compareAlignmentPath(best, current) > 0) {
      best = current;
    }
  }
  return best;
}

function runSemiGlobalAffineAlignment(referenceWindow, querySequence, options = {}) {
  const matchScore = Number(options.matchScore) || DEFAULT_MATCH_SCORE;
  const mismatchScore = Number(options.mismatchScore) || DEFAULT_MISMATCH_SCORE;
  const gapOpenScore = Number(options.gapOpenScore) || DEFAULT_GAP_OPEN_SCORE;
  const gapExtendScore = Number(options.gapExtendScore) || DEFAULT_GAP_EXTEND_SCORE;
  const queryLength = Math.max(0, querySequence.length);
  const referenceLength = Math.max(0, referenceWindow.length);
  const columnCount = referenceLength + 1;
  const cellCount = (queryLength + 1) * columnCount;

  const matchMatrix = new Float64Array(cellCount);
  const queryGapMatrix = new Float64Array(cellCount);
  const referenceGapMatrix = new Float64Array(cellCount);
  const matchCounts = new Int32Array(cellCount);
  const matchCoverage = new Int32Array(cellCount);
  const queryGapCounts = new Int32Array(cellCount);
  const queryGapCoverage = new Int32Array(cellCount);
  const referenceGapCounts = new Int32Array(cellCount);
  const referenceGapCoverage = new Int32Array(cellCount);
  matchMatrix.fill(NEGATIVE_INFINITY_SCORE);
  queryGapMatrix.fill(NEGATIVE_INFINITY_SCORE);
  referenceGapMatrix.fill(NEGATIVE_INFINITY_SCORE);

  const matchTrace = new Int8Array(cellCount);
  const queryGapTrace = new Int8Array(cellCount);
  const referenceGapTrace = new Int8Array(cellCount);
  matchTrace.fill(-1);
  queryGapTrace.fill(-1);
  referenceGapTrace.fill(-1);

  const getIndex = (queryIndex, referenceIndex) => (queryIndex * columnCount) + referenceIndex;

  matchMatrix[getIndex(0, 0)] = 0;
  for (let referenceIndex = 1; referenceIndex <= referenceLength; referenceIndex += 1) {
    matchMatrix[getIndex(0, referenceIndex)] = 0;
    referenceGapMatrix[getIndex(0, referenceIndex)] = 0;
    matchTrace[getIndex(0, referenceIndex)] = STATE_MATCH;
    referenceGapTrace[getIndex(0, referenceIndex)] = STATE_REFERENCE_GAP;
  }

  for (let queryIndex = 1; queryIndex <= queryLength; queryIndex += 1) {
    const index = getIndex(queryIndex, 0);
    if (queryIndex === 1) {
      queryGapMatrix[index] = gapOpenScore;
      queryGapTrace[index] = STATE_MATCH;
    } else {
      const previousIndex = getIndex(queryIndex - 1, 0);
      queryGapMatrix[index] = queryGapMatrix[previousIndex] + gapExtendScore;
      queryGapTrace[index] = STATE_QUERY_GAP;
    }
  }

  for (let queryIndex = 1; queryIndex <= queryLength; queryIndex += 1) {
    const queryBase = querySequence[queryIndex - 1];
    for (let referenceIndex = 1; referenceIndex <= referenceLength; referenceIndex += 1) {
      const referenceBase = referenceWindow[referenceIndex - 1];
      const diagonalIndex = getIndex(queryIndex - 1, referenceIndex - 1);
      const upIndex = getIndex(queryIndex - 1, referenceIndex);
      const leftIndex = getIndex(queryIndex, referenceIndex - 1);
      const cellIndex = getIndex(queryIndex, referenceIndex);
      const isMatch = queryBase === referenceBase;
      const scoreDelta = isMatch ? matchScore : mismatchScore;

      const matchCandidates = [
        {
          score: matchMatrix[diagonalIndex] + scoreDelta,
          matches: matchCounts[diagonalIndex] + (isMatch ? 1 : 0),
          covered: matchCoverage[diagonalIndex] + 1,
          state: STATE_MATCH
        },
        {
          score: queryGapMatrix[diagonalIndex] + scoreDelta,
          matches: queryGapCounts[diagonalIndex] + (isMatch ? 1 : 0),
          covered: queryGapCoverage[diagonalIndex] + 1,
          state: STATE_QUERY_GAP
        },
        {
          score: referenceGapMatrix[diagonalIndex] + scoreDelta,
          matches: referenceGapCounts[diagonalIndex] + (isMatch ? 1 : 0),
          covered: referenceGapCoverage[diagonalIndex] + 1,
          state: STATE_REFERENCE_GAP
        }
      ];
      const bestMatchState = chooseBestPath(matchCandidates);
      matchMatrix[cellIndex] = bestMatchState.score;
      matchCounts[cellIndex] = bestMatchState.matches;
      matchCoverage[cellIndex] = bestMatchState.covered;
      matchTrace[cellIndex] = bestMatchState.state;

      const queryGapCandidates = [
        {
          score: matchMatrix[upIndex] + gapOpenScore,
          matches: matchCounts[upIndex],
          covered: matchCoverage[upIndex],
          state: STATE_MATCH
        },
        {
          score: queryGapMatrix[upIndex] + gapExtendScore,
          matches: queryGapCounts[upIndex],
          covered: queryGapCoverage[upIndex],
          state: STATE_QUERY_GAP
        },
        {
          score: referenceGapMatrix[upIndex] + gapOpenScore,
          matches: referenceGapCounts[upIndex],
          covered: referenceGapCoverage[upIndex],
          state: STATE_REFERENCE_GAP
        }
      ];
      const bestQueryGapState = chooseBestPath(queryGapCandidates);
      queryGapMatrix[cellIndex] = bestQueryGapState.score;
      queryGapCounts[cellIndex] = bestQueryGapState.matches;
      queryGapCoverage[cellIndex] = bestQueryGapState.covered;
      queryGapTrace[cellIndex] = bestQueryGapState.state;

      const referenceGapCandidates = [
        {
          score: matchMatrix[leftIndex] + gapOpenScore,
          matches: matchCounts[leftIndex],
          covered: matchCoverage[leftIndex],
          state: STATE_MATCH
        },
        {
          score: referenceGapMatrix[leftIndex] + gapExtendScore,
          matches: referenceGapCounts[leftIndex],
          covered: referenceGapCoverage[leftIndex],
          state: STATE_REFERENCE_GAP
        },
        {
          score: queryGapMatrix[leftIndex] + gapOpenScore,
          matches: queryGapCounts[leftIndex],
          covered: queryGapCoverage[leftIndex],
          state: STATE_QUERY_GAP
        }
      ];
      const bestReferenceGapState = chooseBestPath(referenceGapCandidates);
      referenceGapMatrix[cellIndex] = bestReferenceGapState.score;
      referenceGapCounts[cellIndex] = bestReferenceGapState.matches;
      referenceGapCoverage[cellIndex] = bestReferenceGapState.covered;
      referenceGapTrace[cellIndex] = bestReferenceGapState.state;
    }
  }

  let bestEnd = {
    score: NEGATIVE_INFINITY_SCORE,
    matches: 0,
    covered: 0,
    state: STATE_MATCH,
    referenceIndex: 0
  };

  for (let referenceIndex = 0; referenceIndex <= referenceLength; referenceIndex += 1) {
    const cellIndex = getIndex(queryLength, referenceIndex);
    [
      {
        score: matchMatrix[cellIndex],
        matches: matchCounts[cellIndex],
        covered: matchCoverage[cellIndex],
        state: STATE_MATCH
      },
      {
        score: queryGapMatrix[cellIndex],
        matches: queryGapCounts[cellIndex],
        covered: queryGapCoverage[cellIndex],
        state: STATE_QUERY_GAP
      },
      {
        score: referenceGapMatrix[cellIndex],
        matches: referenceGapCounts[cellIndex],
        covered: referenceGapCoverage[cellIndex],
        state: STATE_REFERENCE_GAP
      }
    ].forEach((candidate) => {
      if (compareAlignmentPath(bestEnd, candidate) > 0) {
        bestEnd = {
          ...candidate,
          referenceIndex
        };
      }
    });
  }

  if (bestEnd.score <= NEGATIVE_INFINITY_SCORE / 2) {
    return null;
  }

  let queryIndex = queryLength;
  let referenceIndex = bestEnd.referenceIndex;
  let state = bestEnd.state;
  const columns = [];

  while (queryIndex > 0) {
    const cellIndex = getIndex(queryIndex, referenceIndex);
    if (state === STATE_MATCH) {
      if (referenceIndex <= 0) {
        return null;
      }
      const previousState = matchTrace[cellIndex];
      columns.push({
        referenceBase: referenceWindow[referenceIndex - 1],
        queryBase: querySequence[queryIndex - 1],
        referenceOffset: referenceIndex - 1,
        queryOffset: queryIndex - 1
      });
      queryIndex -= 1;
      referenceIndex -= 1;
      state = previousState;
      continue;
    }

    if (state === STATE_QUERY_GAP) {
      const previousState = queryGapTrace[cellIndex];
      columns.push({
        referenceBase: '-',
        queryBase: querySequence[queryIndex - 1],
        referenceOffset: null,
        queryOffset: queryIndex - 1
      });
      queryIndex -= 1;
      state = previousState;
      continue;
    }

    if (referenceIndex <= 0) {
      return null;
    }
    const previousState = referenceGapTrace[cellIndex];
    columns.push({
      referenceBase: referenceWindow[referenceIndex - 1],
      queryBase: '-',
      referenceOffset: referenceIndex - 1,
      queryOffset: null
    });
    referenceIndex -= 1;
    state = previousState;
  }

  columns.reverse();

  return {
    score: bestEnd.score,
    columns,
    referenceStartOffset: referenceIndex,
    referenceEndOffset: bestEnd.referenceIndex
  };
}

function normalizeCircularRange(start, end, referenceLength) {
  let safeStart = Math.max(0, Math.floor(Number(start) || 0));
  let safeEnd = Math.max(safeStart, Math.floor(Number(end) || 0));

  while (safeStart >= referenceLength && safeEnd > referenceLength) {
    safeStart -= referenceLength;
    safeEnd -= referenceLength;
  }

  const spanLength = safeEnd - safeStart;
  if (spanLength > referenceLength) {
    return null;
  }

  if (safeEnd <= referenceLength) {
    return {
      start: safeStart,
      end: safeEnd,
      wraps: false
    };
  }

  return {
    start: safeStart % referenceLength,
    end: safeEnd % referenceLength,
    wraps: true
  };
}

function normalizeReferenceCoordinate(value, referenceLength) {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }
  const safeLength = Math.max(1, Number(referenceLength) || 1);
  let normalized = Math.floor(Number(value) || 0);
  while (normalized >= safeLength) {
    normalized -= safeLength;
  }
  while (normalized < 0) {
    normalized += safeLength;
  }
  return normalized;
}

function normalizeCircularDifferenceRange(start, end, referenceLength) {
  let safeStart = Math.max(0, Math.floor(Number(start) || 0));
  let safeEnd = Math.max(safeStart, Math.floor(Number(end) || 0));

  while (safeStart >= referenceLength && safeEnd > referenceLength) {
    safeStart -= referenceLength;
    safeEnd -= referenceLength;
  }

  if (safeEnd <= referenceLength) {
    return {
      start: safeStart,
      end: safeEnd
    };
  }

  return {
    start: normalizeReferenceCoordinate(safeStart, referenceLength),
    end: normalizeReferenceCoordinate(safeEnd, referenceLength)
  };
}

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
