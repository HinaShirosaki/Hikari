'use strict';

const { asArray } = require('./normalize.js');

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function clamp(value, min, max) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : min;
  return Math.max(min, Math.min(max, numeric));
}

function toIntegerInRange(value, fallback = 8, min = 1, max = 25) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function createUniqueStrings(cleanText = defaultCleanText, maxTextLength = 220) {
  return function uniqueStrings(values, max = 50) {
    const seen = new Set();
    const out = [];

    asArray(values).forEach((value) => {
      const normalized = cleanText(value, maxTextLength);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push(normalized);
    });

    return out;
  };
}

module.exports = {
  asArray,
  clamp,
  createUniqueStrings,
  toIntegerInRange
};
