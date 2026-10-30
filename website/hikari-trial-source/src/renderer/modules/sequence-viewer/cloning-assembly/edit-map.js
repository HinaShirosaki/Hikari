import { SUPPORTED_EDIT_TYPES } from './constants.js';
import { asArray, clampIndex, normalizeSequence } from './sequence-utils.js';

export function normalizeEditRequest(editRequest, templateSequence = '') {
  if (!editRequest || typeof editRequest !== 'object') {
    return null;
  }

  const type = String(editRequest.type || '').trim().toLowerCase();
  if (!SUPPORTED_EDIT_TYPES.has(type)) {
    return null;
  }

  const template = normalizeSequence(templateSequence);
  const originalSequence = normalizeSequence(editRequest.originalSequence || '');
  const editedSequence = normalizeSequence(editRequest.editedSequence || '');
  const position = Number.isFinite(Number(editRequest.position)) ? Math.round(Number(editRequest.position)) : null;
  let start = Number.isFinite(Number(editRequest.start)) ? Math.round(Number(editRequest.start)) : null;
  let end = Number.isFinite(Number(editRequest.end)) ? Math.round(Number(editRequest.end)) : null;

  // `position` and `start` are both 1-based here; downstream converts to a
  // 0-based index via `start - 1` (see startIndex below).
  if (!Number.isFinite(start) && Number.isFinite(position)) {
    start = position;
  }
  if (!Number.isFinite(end) && Number.isFinite(start)) {
    if (type === 'insertion') {
      end = start;
    } else if (originalSequence.length) {
      end = start + originalSequence.length - 1;
    } else if (editedSequence.length) {
      end = start + editedSequence.length - 1;
    } else {
      end = start;
    }
  }

  if ((!Number.isFinite(start) || !Number.isFinite(end)) && originalSequence.length && template.length) {
    const matchIndex = template.indexOf(originalSequence);
    if (matchIndex >= 0) {
      start = matchIndex + 1;
      end = matchIndex + originalSequence.length;
    }
  }

  const startIndex = Number.isFinite(start) ? clampIndex(start - 1, 0, template.length) : 0;
  const endIndex = type === 'insertion'
    ? startIndex
    : (
        Number.isFinite(end)
          ? clampIndex(end, startIndex, template.length)
          : clampIndex(startIndex + originalSequence.length, startIndex, template.length)
      );

  return {
    type,
    position: Number.isFinite(position) ? position : null,
    start: Number.isFinite(start) ? start : (startIndex + 1),
    end: Number.isFinite(end) ? end : endIndex,
    startIndex,
    endIndex,
    originalSequence: originalSequence || template.slice(startIndex, endIndex),
    editedSequence,
    size: Math.max(0, Number(editRequest.size) || editedSequence.length || originalSequence.length)
  };
}

export function buildOrderedFragmentMap({ host, fragments, resultSequence, editRequest }) {
  const orderedFragments = [];
  if (host) {
    orderedFragments.push({
      id: 'host_backbone',
      name: host.name,
      role: 'backbone',
      type: 'backbone',
      orientation: 'forward',
      sequence: host.sequence,
      topology: host.topology,
      metadata: { ...host.metadata }
    });
  }

  asArray(fragments).forEach((fragment) => {
    orderedFragments.push({
      id: fragment.id,
      name: fragment.name,
      role: fragment.type === 'backbone' ? 'backbone' : 'insert',
      type: fragment.type,
      orientation: fragment.orientation,
      sequence: fragment.sequence,
      metadata: { ...fragment.metadata }
    });
  });

  return {
    fragments: orderedFragments,
    fragmentCount: orderedFragments.length,
    resultSequence: normalizeSequence(resultSequence),
    editSummary: editRequest
      ? {
          type: editRequest.type,
          start: editRequest.start,
          end: editRequest.end,
          size: editRequest.size
        }
      : null
  };
}
