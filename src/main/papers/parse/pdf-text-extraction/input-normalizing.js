'use strict';

const path = require('node:path');
const { Buffer } = require('node:buffer');
const { PDF_TEXT_EXTRACTION_ACTIONS } = require('./constants.js');
const { defaultCleanText } = require('./pdf-metadata.js');

function withTrailingSeparator(value) {
  const text = String(value || '');
  return text.endsWith(path.sep) ? text : `${text}${path.sep}`;
}

function normalizeInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, min), max);
}

function normalizeAction(value) {
  const normalized = defaultCleanText(value, 40).toLowerCase();
  if (!normalized) {
    return PDF_TEXT_EXTRACTION_ACTIONS.EXTRACT;
  }
  return Object.values(PDF_TEXT_EXTRACTION_ACTIONS).includes(normalized) ? normalized : '';
}

function bufferLooksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return false;
  }
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

function decodeDataUrlToBuffer(rawDataUrl) {
  const text = String(rawDataUrl || '').trim();
  if (!text.startsWith('data:')) {
    return null;
  }
  const commaIndex = text.indexOf(',');
  if (commaIndex < 0) {
    return null;
  }
  const meta = text.slice(5, commaIndex);
  const payload = text.slice(commaIndex + 1);
  const isBase64 = /;base64$/i.test(meta) || /;base64;/i.test(meta);
  try {
    return isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
  } catch {
    return null;
  }
}

function decodeBase64ToBuffer(rawBase64) {
  const text = String(rawBase64 || '').trim();
  if (!text) {
    return null;
  }
  try {
    return Buffer.from(text, 'base64');
  } catch {
    return null;
  }
}

function normalizePageRange(rawStart, rawEnd, totalPages) {
  const total = Math.max(1, Number(totalPages) || 1);
  const start = normalizeInteger(rawStart, 1, { min: 1, max: total });
  const end = normalizeInteger(rawEnd, total, { min: start, max: total });
  return { start, end };
}

module.exports = {
  bufferLooksLikePdf,
  decodeBase64ToBuffer,
  decodeDataUrlToBuffer,
  normalizeAction,
  normalizeInteger,
  normalizePageRange,
  withTrailingSeparator
};
