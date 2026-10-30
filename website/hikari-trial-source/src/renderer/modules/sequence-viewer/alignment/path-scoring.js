import { DEFAULT_GAP_EXTEND_SCORE, DEFAULT_GAP_OPEN_SCORE, DEFAULT_MATCH_SCORE, DEFAULT_MISMATCH_SCORE, NEGATIVE_INFINITY_SCORE, STATE_MATCH, STATE_QUERY_GAP, STATE_REFERENCE_GAP } from './constants.js';

// Tie-breaking between equal-score paths: higher identity (matches/covered,
// compared by cross-multiplying), then longer coverage, then more matches.
// Returns > 0 when `right` is better.
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

// Gotoh affine-gap alignment of a query (e.g. a Sanger read) against a
// reference window. Semi-global: the whole query must align, but it may start
// and end anywhere in the reference (row 0 and the final row are free), so
// reference overhang costs nothing. Three DP matrices: M (bases aligned),
// query-gap (query base vs '-'), reference-gap (reference base vs '-'); a gap
// costs gapOpen for its first base and gapExtend after. Match/coverage counts
// ride along each cell for tie-breaking. Returns aligned columns plus the
// reference span, or null. Memory is O(query x window), hence the windowing
// in the caller.
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

export {
  runSemiGlobalAffineAlignment
};
