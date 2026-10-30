import { clamp } from '../shared.js';

function normalizeHighlightSegments(segments, sequenceLength = null) {
  const maxLength = Number.isFinite(Number(sequenceLength))
    ? Math.max(0, Number(sequenceLength))
    : Number.POSITIVE_INFINITY;
  const normalized = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, maxLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, maxLength),
      kind: String(segment?.kind || '').toLowerCase() === 'alignment' ? 'alignment' : ''
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }
      return left.end - right.end;
    });

  if (!normalized.length) {
    return [];
  }

  const merged = [normalized[0]];
  for (let i = 1; i < normalized.length; i += 1) {
    const previous = merged[merged.length - 1];
    const current = normalized[i];
    if (current.kind === previous.kind && current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export {
  normalizeHighlightSegments
};
