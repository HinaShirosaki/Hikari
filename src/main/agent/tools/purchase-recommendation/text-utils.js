'use strict';

const { asArray } = require('../../../lib/normalize.js');

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

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const output = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || output.length >= max) {
      return;
    }
    seen.add(key);
    output.push(normalized);
  });
  return output;
}

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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    });
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value, baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw, baseUrl || undefined);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function extractSourceDomain(url) {
  const normalized = safeUrl(url);
  if (!normalized) {
    return '';
  }
  try {
    return String(new URL(normalized).hostname || '').toLowerCase();
  } catch {
    return '';
  }
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
