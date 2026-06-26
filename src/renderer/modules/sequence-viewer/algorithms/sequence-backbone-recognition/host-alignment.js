'use strict';

const { MIN_BACKBONE_SHARED_LENGTH, MIN_HOST_COVERAGE } = require('./constants');
const { collectRotationPairs } = require('./alignment-seeds');
const {
  buildSequenceFromSegments,
  circularRangeToSegments,
  circularSlice,
  clampInteger,
  invertSegments
} = require('./segment-utils');

function commonPrefixLength(left, right, maxLength = Number.POSITIVE_INFINITY) {
  const safeLeft = String(left || '');
  const safeRight = String(right || '');
  const safeMax = Math.min(
    safeLeft.length,
    safeRight.length,
    Number.isFinite(maxLength) ? Math.max(0, Math.round(maxLength)) : Number.MAX_SAFE_INTEGER
  );
  let matched = 0;
  while (matched < safeMax && safeLeft[matched] === safeRight[matched]) {
    matched += 1;
  }
  return matched;
}

function commonSuffixLength(left, right, maxLength = Number.POSITIVE_INFINITY) {
  const safeLeft = String(left || '');
  const safeRight = String(right || '');
  const safeMax = Math.min(
    safeLeft.length,
    safeRight.length,
    Number.isFinite(maxLength) ? Math.max(0, Math.round(maxLength)) : Number.MAX_SAFE_INTEGER
  );
  let matched = 0;
  while (matched < safeMax && safeLeft[safeLeft.length - 1 - matched] === safeRight[safeRight.length - 1 - matched]) {
    matched += 1;
  }
  return matched;
}

function evaluateSingleInsertAlignment(hostSequence, querySequence, hostStart, queryStart) {
  const hostLength = hostSequence.length;
  const queryLength = querySequence.length;
  const rotatedHost = circularSlice(hostSequence, hostStart, hostLength);
  const rotatedQuery = circularSlice(querySequence, queryStart, queryLength);
  const prefixLength = commonPrefixLength(rotatedHost, rotatedQuery, hostLength);
  const suffixLength = Math.min(
    commonSuffixLength(rotatedHost, rotatedQuery, hostLength),
    Math.max(0, hostLength - prefixLength)
  );
  const insertWindowStart = clampInteger(prefixLength, 0, queryLength, 0);
  const insertWindowEnd = clampInteger(queryLength - suffixLength, insertWindowStart, queryLength, insertWindowStart);

  return {
    hostStart,
    queryStart,
    prefixLength,
    suffixLength,
    backboneLength: prefixLength + suffixLength,
    insertWindowStart,
    insertWindowEnd,
    insertLength: Math.max(0, insertWindowEnd - insertWindowStart)
  };
}

function compareAlignmentCandidates(left, right) {
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  if (left.backboneLength !== right.backboneLength) {
    return right.backboneLength - left.backboneLength;
  }
  if (left.hostCoverage !== right.hostCoverage) {
    return right.hostCoverage - left.hostCoverage;
  }
  if (left.insertLength !== right.insertLength) {
    return left.insertLength - right.insertLength;
  }
  if (left.orientationRank !== right.orientationRank) {
    return left.orientationRank - right.orientationRank;
  }
  if (left.hostStart !== right.hostStart) {
    return left.hostStart - right.hostStart;
  }
  return left.queryStart - right.queryStart;
}

function analyzeHostVectorAgainstQuery(entry, hostSequence, querySequence, reverseComplementIupac) {
  const normalizedHost = String(hostSequence || '');
  const normalizedQuery = String(querySequence || '');
  if (!normalizedHost.length || !normalizedQuery.length) {
    return null;
  }

  let best = null;
  buildOrientations(normalizedHost, reverseComplementIupac).forEach((orientation) => {
    collectRotationPairs(orientation.sequence, normalizedQuery).forEach((pair) => {
      const candidate = evaluateSingleInsertAlignment(orientation.sequence, normalizedQuery, pair.hostStart, pair.queryStart);
      const insertSegments = circularRangeToSegments(
        pair.queryStart + candidate.insertWindowStart,
        candidate.insertLength,
        normalizedQuery.length
      );
      const backboneSegments = invertSegments(insertSegments, normalizedQuery.length);
      const enriched = {
        ...candidate,
        entryId: entry.id,
        hostLength: orientation.sequence.length,
        hostCoverage: orientation.sequence.length > 0 ? candidate.backboneLength / orientation.sequence.length : 0,
        orientation: orientation.label,
        orientationRank: orientation.orientationRank,
        insertSegments,
        backboneSegments,
        insertSequence: buildSequenceFromSegments(normalizedQuery, insertSegments),
        backboneSequence: buildSequenceFromSegments(normalizedQuery, backboneSegments)
      };
      if (compareAlignmentCandidates(enriched, best) < 0) {
        best = enriched;
      }
    });
  });
  return best;
}

function buildOrientations(normalizedHost, reverseComplementIupac) {
  const orientations = [{ label: 'forward', sequence: normalizedHost, orientationRank: 0 }];
  const reverseHost = reverseComplementIupac(normalizedHost);
  if (reverseHost && reverseHost !== normalizedHost) {
    orientations.push({ label: 'reverse', sequence: reverseHost, orientationRank: 1 });
  }
  return orientations;
}

function isAlignmentAcceptable(alignment) {
  if (!alignment) {
    return false;
  }
  const minimumSharedLength = Math.min(
    Math.max(MIN_BACKBONE_SHARED_LENGTH, Math.floor((alignment?.hostLength || 0) * 0.5)),
    alignment?.hostLength || 0
  );
  if (alignment.backboneLength < minimumSharedLength) {
    return false;
  }
  return alignment.hostCoverage >= MIN_HOST_COVERAGE || alignment.hostLength <= 48;
}

module.exports = {
  analyzeHostVectorAgainstQuery,
  isAlignmentAcceptable
};
