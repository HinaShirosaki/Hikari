'use strict';

const {
  MAX_ANNOTATION_MATCHES_PER_FEATURE
} = require('./constants');
const {
  clamp,
  normalizeSequenceText,
  normalizeTopologyValue,
  positiveModulo
} = require('./utils');

function buildSegmentsFromStartAndLength(start, length, sequenceLength, topology = 'linear') {
  const normalizedLength = Math.max(0, Number(sequenceLength) || 0);
  const normalizedSpan = Math.max(0, Number(length) || 0);
  if (!normalizedLength || normalizedSpan <= 0) {
    return [];
  }

  if (normalizeTopologyValue(topology) === 'linear') {
    const safeStart = clamp(Math.round(Number(start) || 0), 0, normalizedLength);
    const safeEnd = clamp(safeStart + normalizedSpan, 0, normalizedLength);
    return safeEnd > safeStart ? [{ start: safeStart, end: safeEnd }] : [];
  }

  const circularStart = positiveModulo(Math.round(Number(start) || 0), normalizedLength);
  if (normalizedSpan >= normalizedLength) {
    if (circularStart === 0) {
      return [{ start: 0, end: normalizedLength }];
    }
    return [
      { start: circularStart, end: normalizedLength },
      { start: 0, end: circularStart }
    ];
  }

  const circularEnd = (circularStart + normalizedSpan) % normalizedLength;
  if (circularEnd > circularStart) {
    return [{ start: circularStart, end: circularEnd }];
  }
  if (circularEnd === circularStart) {
    return [{ start: 0, end: normalizedLength }];
  }
  return [
    { start: circularStart, end: normalizedLength },
    { start: 0, end: circularEnd }
  ];
}

function readCircularCodon(sequence, start) {
  const text = String(sequence || '');
  const length = text.length;
  if (length < 3) {
    return '';
  }
  const first = text[positiveModulo(start, length)] || '';
  const second = text[positiveModulo(start + 1, length)] || '';
  const third = text[positiveModulo(start + 2, length)] || '';
  return `${first}${second}${third}`;
}

function readSequenceSpan(sequence, start, length, topology = 'linear') {
  const text = String(sequence || '');
  const safeLength = Math.max(0, Number(length) || 0);
  if (!text.length || safeLength <= 0) {
    return '';
  }

  if (normalizeTopologyValue(topology) === 'linear') {
    const safeStart = clamp(Math.round(Number(start) || 0), 0, text.length);
    return text.slice(safeStart, safeStart + safeLength);
  }

  let output = '';
  const safeStart = positiveModulo(Math.round(Number(start) || 0), text.length);
  for (let index = 0; index < safeLength; index += 1) {
    output += text[positiveModulo(safeStart + index, text.length)] || '';
  }
  return output;
}

function findPatternMatchStarts(querySequence, patternSequence, topology = 'linear', maxHits = MAX_ANNOTATION_MATCHES_PER_FEATURE) {
  const query = normalizeSequenceText(querySequence);
  const pattern = normalizeSequenceText(patternSequence);
  if (!query.length || !pattern.length || pattern.length > query.length) {
    return [];
  }
  if (pattern.length === query.length) {
    return query === pattern ? [0] : [];
  }

  const haystack = normalizeTopologyValue(topology) === 'circular'
    ? `${query}${query.slice(0, Math.max(0, pattern.length - 1))}`
    : query;
  const starts = [];
  let cursor = 0;
  while (starts.length < Math.max(1, Number(maxHits) || MAX_ANNOTATION_MATCHES_PER_FEATURE)) {
    const matchIndex = haystack.indexOf(pattern, cursor);
    if (matchIndex < 0 || matchIndex >= query.length) {
      break;
    }
    starts.push(matchIndex);
    cursor = matchIndex + 1;
  }
  return starts;
}

module.exports = {
  buildSegmentsFromStartAndLength,
  findPatternMatchStarts,
  readCircularCodon,
  readSequenceSpan
};
