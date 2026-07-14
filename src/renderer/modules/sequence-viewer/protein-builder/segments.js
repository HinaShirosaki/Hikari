import { reverseComplementDna } from '../calculations/sequence.js';
import { clamp, normalizeSequenceText } from '../shared.js';

export function normalizeRecordSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter(Boolean);
}

export function extractDnaFromRecordSegments(sequence, segments, strand = 1) {
  const cleanedSequence = normalizeSequenceText(sequence);
  const normalizedSegments = normalizeRecordSegments(segments, cleanedSequence.length);
  if (!cleanedSequence.length || !normalizedSegments.length) {
    return '';
  }

  const orderedSegments = strand === -1
    ? [...normalizedSegments].reverse()
    : normalizedSegments;
  const rawSequence = orderedSegments
    .map((segment) => cleanedSequence.slice(segment.start, segment.end))
    .join('');
  return strand === -1 ? reverseComplementDna(rawSequence) : rawSequence;
}

export function mergeSegments(segments) {
  const normalized = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = Math.max(0, Math.round(Number(segment?.start) || 0));
      const end = Math.max(start, Math.round(Number(segment?.end) || 0));
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    });

  if (!normalized.length) {
    return [];
  }

  return normalized.reduce((merged, segment) => {
    const last = merged[merged.length - 1];
    if (!last || segment.start > last.end) {
      merged.push({ ...segment });
      return merged;
    }
    last.end = Math.max(last.end, segment.end);
    return merged;
  }, []);
}

export function sumSegmentLength(segments) {
  return mergeSegments(segments)
    .reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0);
}

export function buildSequenceFromSegments(sequence, segments) {
  const normalizedSequence = normalizeSequenceText(sequence);
  const normalizedSegments = normalizeRecordSegments(segments, normalizedSequence.length);
  if (!normalizedSequence.length || !normalizedSegments.length) {
    return '';
  }
  return normalizedSegments
    .map((segment) => normalizedSequence.slice(segment.start, segment.end))
    .join('');
}

export function invertSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  const normalized = normalizeRecordSegments(segments, safeLength)
    .sort((left, right) => left.start - right.start);
  if (!safeLength) {
    return [];
  }
  if (!normalized.length) {
    return safeLength ? [{ start: 0, end: safeLength }] : [];
  }

  const inverted = [];
  let cursor = 0;
  normalized.forEach((segment) => {
    if (segment.start > cursor) {
      inverted.push({ start: cursor, end: segment.start });
    }
    cursor = Math.max(cursor, segment.end);
  });
  if (cursor < safeLength) {
    inverted.push({ start: cursor, end: safeLength });
  }
  return inverted;
}
