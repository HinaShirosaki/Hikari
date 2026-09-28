'use strict';

const { BASE_MASKS, REVERSE_COMPLEMENT_MAP } = require('./constants');
const { positiveModulo } = require('../positive-modulo.cjs');

function cleanText(value) {
  const text = String(value == null ? '' : value)
    .replace(/\s+/g, ' ');
  return text || '';
}

function clampInteger(value, min, max, fallback = min) {
  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeTopology(value) {
  return String(value || '').trim().toLowerCase() === 'linear' ? 'linear' : 'circular';
}

function normalizeDnaSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/^>.*$/gm, '')
    .replace(/U/g, 'T')
    .replace(/[^ACGTRYSWKMBDHVNX]/g, '');
}

function containsOnlyStrictBases(sequence) {
  return /^[ACGT]+$/.test(String(sequence || ''));
}

function reverseComplementDna(sequence) {
  const text = String(sequence || '').toUpperCase();
  let output = '';
  for (let index = text.length - 1; index >= 0; index -= 1) {
    output += REVERSE_COMPLEMENT_MAP[text[index]] || 'N';
  }
  return output;
}

function buildBaseMaskArray(sequence) {
  const text = String(sequence || '');
  const masks = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    masks[index] = BASE_MASKS[text[index]] || BASE_MASKS.N;
  }
  return masks;
}

function buildCircularSegments(start, length, queryLength) {
  const normalizedQueryLength = Math.max(0, Number(queryLength) || 0);
  const normalizedLength = Math.max(0, Number(length) || 0);
  if (!normalizedQueryLength || !normalizedLength) {
    return [];
  }

  const safeStart = positiveModulo(start, normalizedQueryLength);
  if (normalizedLength >= normalizedQueryLength) {
    if (safeStart === 0) {
      return [{ start: 0, end: normalizedQueryLength }];
    }
    return [
      { start: safeStart, end: normalizedQueryLength },
      { start: 0, end: safeStart }
    ];
  }

  const rawEnd = safeStart + normalizedLength;
  if (rawEnd <= normalizedQueryLength) {
    return [{ start: safeStart, end: rawEnd }];
  }

  return [
    { start: safeStart, end: normalizedQueryLength },
    { start: 0, end: rawEnd - normalizedQueryLength }
  ];
}

function formatCircularLocation(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => `${segment.start + 1}..${segment.end}`)
    .join(', ');
}

module.exports = {
  buildBaseMaskArray,
  buildCircularSegments,
  clampInteger,
  cleanText,
  containsOnlyStrictBases,
  formatCircularLocation,
  normalizeDnaSequence,
  normalizeTopology,
  positiveModulo,
  reverseComplementDna
};
