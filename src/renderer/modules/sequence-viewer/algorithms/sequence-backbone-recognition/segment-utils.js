'use strict';

const { positiveModulo } = require('../positive-modulo.cjs');

function clampInteger(value, min, max, fallback = min) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeDisplayName(value, fallback = 'feature') {
  const text = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return text || fallback;
}

function normalizeSegments(segments, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      start: clampInteger(segment?.start, 0, safeLength, 0),
      end: clampInteger(segment?.end, 0, safeLength, 0)
    }))
    .filter((segment) => segment.end > segment.start);
}

function mergeSegments(segments, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  return normalizeSegments(segments, safeLength)
    .sort((left, right) => (left.start - right.start) || (left.end - right.end))
    .reduce((acc, segment) => {
      const previous = acc[acc.length - 1];
      if (!previous || segment.start > previous.end) {
        acc.push({ ...segment });
        return acc;
      }
      previous.end = Math.max(previous.end, segment.end);
      return acc;
    }, []);
}

function sumSegmentLength(segments) {
  return (Array.isArray(segments) ? segments : [])
    .reduce((sum, segment) => sum + Math.max(0, (segment?.end || 0) - (segment?.start || 0)), 0);
}

function circularSlice(sequence, start, length) {
  const text = String(sequence || '');
  const totalLength = text.length;
  const desiredLength = Math.max(0, Math.round(Number(length) || 0));
  if (!totalLength || !desiredLength) {
    return '';
  }

  let cursor = positiveModulo(Math.round(Number(start) || 0), totalLength);
  let remaining = desiredLength;
  let result = '';
  while (remaining > 0) {
    const chunkLength = Math.min(remaining, totalLength - cursor);
    result += text.slice(cursor, cursor + chunkLength);
    remaining -= chunkLength;
    cursor = 0;
  }
  return result;
}

function circularRangeToSegments(start, length, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  const desiredLength = Math.max(0, Math.round(Number(length) || 0));
  if (!safeLength || !desiredLength) {
    return [];
  }
  if (desiredLength >= safeLength) {
    return [{ start: 0, end: safeLength }];
  }

  const safeStart = positiveModulo(Math.round(Number(start) || 0), safeLength);
  const end = safeStart + desiredLength;
  if (end <= safeLength) {
    return [{ start: safeStart, end }];
  }
  return mergeSegments([
    { start: safeStart, end: safeLength },
    { start: 0, end: end - safeLength }
  ], safeLength);
}

function invertSegments(segments, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  if (!safeLength) {
    return [];
  }

  const merged = mergeSegments(segments, safeLength);
  if (!merged.length) {
    return [{ start: 0, end: safeLength }];
  }

  const inverse = [];
  let cursor = 0;
  merged.forEach((segment) => {
    if (segment.start > cursor) {
      inverse.push({ start: cursor, end: segment.start });
    }
    cursor = Math.max(cursor, segment.end);
  });
  if (cursor < safeLength) {
    inverse.push({ start: cursor, end: safeLength });
  }
  return inverse;
}

function buildSequenceFromSegments(sequence, segments) {
  const text = String(sequence || '');
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => text.slice(segment.start, segment.end))
    .join('');
}

function overlapLength(leftSegments, rightSegments) {
  const left = mergeSegments(leftSegments, Number.MAX_SAFE_INTEGER);
  const right = mergeSegments(rightSegments, Number.MAX_SAFE_INTEGER);
  let leftIndex = 0;
  let rightIndex = 0;
  let total = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    const leftSegment = left[leftIndex];
    const rightSegment = right[rightIndex];
    const start = Math.max(leftSegment.start, rightSegment.start);
    const end = Math.min(leftSegment.end, rightSegment.end);
    if (end > start) {
      total += end - start;
    }
    if (leftSegment.end <= rightSegment.end) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return total;
}

module.exports = {
  buildSequenceFromSegments,
  circularRangeToSegments,
  circularSlice,
  clampInteger,
  invertSegments,
  mergeSegments,
  normalizeDisplayName,
  overlapLength,
  positiveModulo,
  sumSegmentLength
};
