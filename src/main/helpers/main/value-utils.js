'use strict';

function defaultCleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function createUniqueStrings(cleanText = defaultCleanText) {
  return function uniqueStrings(values, max = 50) {
    const seen = new Set();
    const out = [];

    asArray(values).forEach((value) => {
      const normalized = cleanText(value, 220);
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
