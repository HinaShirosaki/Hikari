'use strict';

const { createUniqueStrings } = require('../../../lib/value-utils.js');
const {
  decodeXmlEntities: decodeHtmlEntities,
  extractSourceDomain,
  safeHttpUrl: safeUrl,
  stripHtml
} = require('../../../lib/web-text.js');

function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function sliceText(value, max = 1200) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

const uniqueStrings = createUniqueStrings(cleanText, 0);

function tokenizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampInteger(value, fallback = 6, min = 1, max = 25) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function hasFiniteNumber(value) {
  if (value == null || value === '') {
    return false;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric);
}

module.exports = {
  cleanText,
  sliceText,
  uniqueStrings,
  tokenizeSearchText,
  normalizeMatchText,
  clampInteger,
  decodeHtmlEntities,
  stripHtml,
  safeUrl,
  extractSourceDomain,
  hasFiniteNumber
};
