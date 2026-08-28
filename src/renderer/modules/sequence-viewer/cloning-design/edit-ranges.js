import { clamp, cleanText, normalizeSequenceText } from '../shared.js';
import { asArray } from '../../../lib/normalize.js';

function buildSourceKey(source = {}) {
  const edit = source?.editRequest || {};
  return [
    cleanText(source?.recordName, 160),
    normalizeSequenceText(source?.editedSequence || '').length,
    cleanText(edit.type, 80),
    Math.max(0, Number(edit.start) || 0),
    Math.max(0, Number(edit.end) || 0),
    normalizeSequenceText(edit.originalSequence || ''),
    normalizeSequenceText(edit.editedSequence || '')
  ].join('|');
}

function getEditStartIndex(source = {}) {
  const rangeStart = Number(source?.editedRange?.start);
  if (Number.isFinite(rangeStart)) {
    return Math.max(0, Math.round(rangeStart));
  }
  const editStart = Number(source?.editRequest?.start);
  return Math.max(0, Number.isFinite(editStart) ? Math.round(editStart) - 1 : 0);
}

function getEditEndIndex(source = {}) {
  const rangeEnd = Number(source?.editedRange?.end);
  if (Number.isFinite(rangeEnd)) {
    return Math.max(getEditStartIndex(source), Math.round(rangeEnd));
  }
  const editedLength = normalizeSequenceText(source?.editRequest?.editedSequence || '').length;
  return getEditStartIndex(source) + Math.max(1, editedLength);
}

function getFeatureRangeContainingEdit(record = {}, source = {}) {
  const sequenceLength = normalizeSequenceText(record?.sequence || '').length;
  const editStart = getEditStartIndex(source);
  const editEnd = Math.max(editStart + 1, getEditEndIndex(source));
  const candidates = asArray(record?.features)
    .map((feature) => {
      const segments = asArray(feature?.segments)
        .map((segment) => ({
          start: clamp(Math.round(Number(segment?.start) || 0), 0, sequenceLength),
          end: clamp(Math.round(Number(segment?.end) || 0), 0, sequenceLength)
        }))
        .filter((segment) => segment.end > segment.start);
      if (!segments.length) {
        return null;
      }
      const start = Math.min(...segments.map((segment) => segment.start));
      const end = Math.max(...segments.map((segment) => segment.end));
      if (start > editStart || end < editEnd) {
        return null;
      }
      const type = cleanText(feature?.type, 120).toLowerCase();
      const priority = ['cds', 'insert', 'open_reading_frame', 'orf', 'misc_feature'].includes(type) ? 0 : 1;
      return {
        start,
        end,
        length: end - start,
        priority
      };
    })
    .filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.length !== right.length) {
      return left.length - right.length;
    }
    return left.start - right.start;
  });
  return candidates[0];
}

function deriveDefaultInsertRange(record = {}, source = {}) {
  const sequenceLength = normalizeSequenceText(record?.sequence || source?.editedSequence || '').length;
  if (!sequenceLength) {
    return { start: 0, end: 0 };
  }

  const featureRange = getFeatureRangeContainingEdit(record, source);
  if (featureRange) {
    return featureRange;
  }

  const editStart = clamp(getEditStartIndex(source), 0, sequenceLength);
  const editEnd = clamp(Math.max(editStart + 1, getEditEndIndex(source)), editStart + 1, sequenceLength);
  const minimumSpan = Math.min(sequenceLength, Math.max(120, editEnd - editStart));
  let start = Math.max(0, editStart - 120);
  let end = Math.min(sequenceLength, editEnd + 120);

  if (end - start < minimumSpan) {
    const extra = minimumSpan - (end - start);
    const leftExtra = Math.min(start, Math.floor(extra / 2));
    start -= leftExtra;
    end = Math.min(sequenceLength, end + extra - leftExtra);
    if (end - start < minimumSpan) {
      start = Math.max(0, start - (minimumSpan - (end - start)));
    }
  }

  return {
    start,
    end: Math.max(start + 1, end)
  };
}

function mapEditedIndexToOriginal(index, source = {}) {
  const safeIndex = Math.max(0, Math.round(Number(index) || 0));
  const editStart = getEditStartIndex(source);
  const originalLength = normalizeSequenceText(source?.editRequest?.originalSequence || '').length;
  const editedLength = normalizeSequenceText(source?.editRequest?.editedSequence || '').length;
  const editedEnd = editStart + editedLength;
  const delta = editedLength - originalLength;

  if (safeIndex <= editStart) {
    return safeIndex;
  }
  if (safeIndex >= editedEnd) {
    return Math.max(0, safeIndex - delta);
  }
  return editStart;
}

function extractOriginalTemplateForEditedRange(source = {}, start, end) {
  const originalSequence = normalizeSequenceText(source?.originalSequence || '');
  if (!originalSequence.length) {
    return '';
  }

  const originalStart = clamp(mapEditedIndexToOriginal(start, source), 0, originalSequence.length);
  let originalEnd = clamp(mapEditedIndexToOriginal(end, source), originalStart, originalSequence.length);
  if (originalEnd <= originalStart) {
    const editedSpan = Math.max(1, Math.round(Number(end) || 0) - Math.round(Number(start) || 0));
    originalEnd = clamp(originalStart + editedSpan, originalStart, originalSequence.length);
  }
  return originalSequence.slice(originalStart, originalEnd);
}

function buildLinearizedBackbone(sequence, start, end) {
  const cleaned = normalizeSequenceText(sequence || '');
  const sequenceLength = cleaned.length;
  if (!sequenceLength) {
    return '';
  }
  const safeStart = clamp(Math.round(Number(start) || 0), 0, sequenceLength);
  const safeEnd = clamp(Math.round(Number(end) || safeStart), safeStart, sequenceLength);
  return `${cleaned.slice(safeEnd)}${cleaned.slice(0, safeStart)}`;
}

export {
  buildLinearizedBackbone,
  buildSourceKey,
  deriveDefaultInsertRange,
  extractOriginalTemplateForEditedRange,
  getEditEndIndex,
  getEditStartIndex
};
