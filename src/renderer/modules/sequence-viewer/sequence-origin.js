import { clamp, normalizeSequenceText, normalizeTopology } from './shared.js';

// Keep GenBank segment order: it determines the coding sequence for joined
// and reverse-strand features, including features crossing the new origin.
function rotateFeatureSegments(segments, origin, sequenceLength) {
  const rotated = [];
  function append(segment) {
    const previous = rotated[rotated.length - 1];
    if (previous?.end === segment.start) {
      previous.end = segment.end;
    } else {
      rotated.push(segment);
    }
  }
  (Array.isArray(segments) ? segments : []).forEach((segment) => {
    const start = clamp(Math.round(Number(segment?.start) || 0), 0, sequenceLength);
    const end = clamp(Math.round(Number(segment?.end) || 0), start, sequenceLength);
    if (end <= start) return;
    const nextStart = (start - origin + sequenceLength) % sequenceLength;
    const nextEnd = nextStart + end - start;
    append({ start: nextStart, end: Math.min(nextEnd, sequenceLength) });
    if (nextEnd > sequenceLength) {
      append({ start: 0, end: nextEnd - sequenceLength });
    }
  });
  return rotated;
}

export function rotateCircularSequenceRecord(record, cursorBase) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  if (!sequence.length || normalizeTopology(record?.topology) !== 'circular') {
    throw new Error('Only circular plasmids can have their sequence start changed.');
  }
  if (!Number.isFinite(cursorBase) || cursorBase < 0 || cursorBase > sequence.length) {
    throw new Error('Choose a cursor position within the sequence.');
  }
  const origin = Math.round(cursorBase) % sequence.length;
  if (!origin) return record;
  const nextRecord = {
    ...record,
    sequence: sequence.slice(origin) + sequence.slice(0, origin),
    features: (Array.isArray(record.features) ? record.features : []).map((feature) => ({
      ...feature,
      segments: rotateFeatureSegments(feature.segments, origin, sequence.length),
      locationText: ''
    }))
  };
  if (typeof record.quality === 'string' && record.quality.length === sequence.length) {
    nextRecord.quality = record.quality.slice(origin) + record.quality.slice(0, origin);
  }
  return nextRecord;
}
