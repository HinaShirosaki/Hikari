import {
  cleanText,
  clamp,
  normalizeSequenceText
} from '../shared.js';

export function normalizeEditedFeatureSegment(segment, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
  const end = clamp(Math.round(Number(segment?.end) || 0), start, safeLength);
  return end > start ? { start, end } : null;
}

export function mergeEditedFeatureSegments(segments, sequenceLength) {
  const normalized = (Array.isArray(segments) ? segments : [])
    .map((segment) => normalizeEditedFeatureSegment(segment, sequenceLength))
    .filter(Boolean)
    .sort((left, right) => (left.start - right.start) || (left.end - right.end));
  if (!normalized.length) {
    return [];
  }

  const merged = [normalized[0]];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = normalized[index];
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export function adjustFeatureSegmentsForSequenceEdit(features, editRange, replacementLength, nextSequenceLength) {
  const editStart = Math.max(0, Math.round(Number(editRange?.start) || 0));
  const editEnd = Math.max(editStart, Math.round(Number(editRange?.end) || editStart));
  const insertLength = Math.max(0, Math.round(Number(replacementLength) || 0));
  const delta = insertLength - Math.max(0, editEnd - editStart);
  const safeNextLength = Math.max(0, Number(nextSequenceLength) || 0);
  return (Array.isArray(features) ? features : [])
    .map((feature) => adjustFeatureForEdit(feature, editStart, editEnd, delta, insertLength, safeNextLength))
    .filter(Boolean);
}

export function buildSequenceEditStatus(mode, range, replacementLength) {
  const start = Math.max(0, Math.round(Number(range?.start) || 0));
  const end = Math.max(start, Math.round(Number(range?.end) || start));
  const selectedLength = Math.max(0, end - start);
  const insertedLength = Math.max(0, Number(replacementLength) || 0);
  if (mode === 'delete') {
    return `Deleted ${selectedLength.toLocaleString()} bp.`;
  }
  if (mode === 'replace') {
    return `Replaced ${selectedLength.toLocaleString()} bp with ${insertedLength.toLocaleString()} bp.`;
  }
  return `Inserted ${insertedLength.toLocaleString()} bp.`;
}

export function buildSequenceEditDesignSource({ record, previousSequence, nextSequence, mode, start, end, replacement } = {}) {
  const originalChangedSequence = normalizeSequenceText(previousSequence || '').slice(start, end);
  const editedChangedSequence = mode === 'delete' ? '' : normalizeSequenceText(replacement || '').replace(/\*/g, '');
  const type = mode === 'insert'
    ? 'insertion'
    : mode === 'delete'
      ? 'deletion'
      : (originalChangedSequence.length === 1 && editedChangedSequence.length === 1 ? 'point-mutation' : 'replacement');
  const oneBasedStart = Math.max(1, Math.round(Number(start) || 0) + 1);
  const oneBasedEnd = mode === 'insert' ? oneBasedStart : Math.max(oneBasedStart, Math.round(Number(end) || 0));
  return {
    recordName: cleanText(record?.name, 160) || 'sequence',
    originalSequence: normalizeSequenceText(previousSequence || ''),
    editedSequence: normalizeSequenceText(nextSequence || ''),
    originalRange: { start, end },
    editedRange: { start, end: start + editedChangedSequence.length },
    editRequest: {
      type,
      position: oneBasedStart,
      start: oneBasedStart,
      end: oneBasedEnd,
      originalSequence: originalChangedSequence,
      editedSequence: editedChangedSequence,
      size: Math.max(originalChangedSequence.length, editedChangedSequence.length)
    },
    updatedAt: new Date().toISOString()
  };
}

function adjustFeatureForEdit(feature, editStart, editEnd, delta, insertLength, safeNextLength) {
  if (!Array.isArray(feature?.segments)) {
    return feature;
  }
  const adjustedSegments = feature.segments.map((segment) => adjustSegmentForEdit(segment, editStart, editEnd, delta, insertLength)).filter(Boolean);
  const mergedSegments = mergeEditedFeatureSegments(adjustedSegments, safeNextLength);
  return mergedSegments.length ? { ...feature, locationText: '', segments: mergedSegments } : null;
}

function adjustSegmentForEdit(segment, editStart, editEnd, delta, insertLength) {
  const start = Math.max(0, Math.round(Number(segment?.start) || 0));
  const end = Math.max(start, Math.round(Number(segment?.end) || start));
  if (end <= start) {
    return null;
  }
  if (end <= editStart) {
    return { start, end };
  }
  if (start >= editEnd) {
    return { start: start + delta, end: end + delta };
  }
  const nextStart = start < editStart ? start : editStart;
  const nextEnd = end > editEnd ? end + delta : editStart + insertLength;
  return nextEnd > nextStart ? { start: nextStart, end: nextEnd } : null;
}
