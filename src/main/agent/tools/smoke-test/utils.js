'use strict';

const { asArray } = require('../../../lib/normalize.js');

function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value);
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
}

function countWords(value) {
  return cleanText(value)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function resolveToolMessage(message, fallback) {
  return cleanText(message) || cleanText(fallback);
}

function resolveFocusedToolText(message, fallback, maxWords = 6) {
  const normalizedMessage = cleanText(message);
  if (!normalizedMessage) {
    return cleanText(fallback);
  }
  if (countWords(normalizedMessage) <= maxWords) {
    return normalizedMessage;
  }
  return cleanText(fallback);
}

module.exports = {
  cleanText,
  uniqueStrings,
  countWords,
  resolveToolMessage,
  resolveFocusedToolText
};
