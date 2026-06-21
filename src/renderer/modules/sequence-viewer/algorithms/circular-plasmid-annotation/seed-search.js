'use strict';

const { buildBaseMaskArray, clampInteger } = require('./dna-utils');

function resolveAllowedMismatchCount(patternLength, options) {
  const byCount = clampInteger(
    options?.maxMismatchCount,
    0,
    Math.max(0, patternLength),
    0
  );
  const numericRate = Number(options?.maxMismatchRate);
  const byRate = Number.isFinite(numericRate) && numericRate > 0
    ? Math.floor(patternLength * numericRate)
    : 0;
  return Math.max(0, Math.min(patternLength, Math.max(byCount, byRate)));
}

function longestStrictRun(text, minLength) {
  const sequence = String(text || '');
  const minimum = Math.max(1, Number(minLength) || 1);
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index <= sequence.length; index += 1) {
    const strict = index < sequence.length && /[ACGT]/.test(sequence[index]);
    if (strict) {
      if (currentStart === -1) {
        currentStart = index;
      }
      currentLength += 1;
      continue;
    }

    if (currentLength >= minimum && currentLength > bestLength) {
      bestStart = currentStart;
      bestLength = currentLength;
    }

    currentStart = -1;
    currentLength = 0;
  }

  return bestStart >= 0 ? { start: bestStart, length: bestLength } : null;
}

function chooseSeedWindows(pattern, allowedMismatches, minSeedLength) {
  const sequence = String(pattern || '');
  if (!sequence.length) {
    return [];
  }

  const segmentCount = Math.max(1, allowedMismatches + 1);
  const desiredSeedLength = Math.max(
    1,
    Math.min(
      sequence.length,
      Math.max(1, Math.floor(sequence.length / segmentCount), Number(minSeedLength) || 1)
    )
  );

  const seeds = [];
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const segmentStart = Math.floor((segmentIndex * sequence.length) / segmentCount);
    const segmentEnd = Math.floor(((segmentIndex + 1) * sequence.length) / segmentCount);
    const segment = sequence.slice(segmentStart, segmentEnd);
    if (!segment.length) {
      continue;
    }

    const strictRun = longestStrictRun(segment, Math.min(desiredSeedLength, segment.length));
    if (!strictRun) {
      continue;
    }
    seeds.push({
      offset: segmentStart + strictRun.start,
      text: segment.slice(strictRun.start, strictRun.start + strictRun.length)
    });
  }

  return seeds
    .filter((seed) => seed.text.length > 0)
    .sort((left, right) => right.text.length - left.text.length);
}

function countCircularMismatches(queryMasks, pattern, start, allowedMismatches) {
  const limit = Math.max(0, Number(allowedMismatches) || 0);
  const patternMasks = buildBaseMaskArray(pattern);
  let mismatches = 0;

  for (let index = 0; index < patternMasks.length; index += 1) {
    if ((queryMasks[start + index] & patternMasks[index]) === 0) {
      mismatches += 1;
      if (mismatches > limit) {
        return Number.POSITIVE_INFINITY;
      }
    }
  }

  return mismatches;
}

module.exports = {
  chooseSeedWindows,
  countCircularMismatches,
  resolveAllowedMismatchCount
};
