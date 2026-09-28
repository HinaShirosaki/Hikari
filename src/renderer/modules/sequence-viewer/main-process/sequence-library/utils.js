'use strict';

const crypto = require('crypto');
const {
  BASE_COMPLEMENT,
  STATUS_SAVED,
  STATUS_TEMPORARY
} = require('./constants');
const { positiveModulo } = require('../../algorithms/positive-modulo.cjs');

function cleanText(value) {
  const text = String(value || '');
  return text || '';
}

function normalizeStatus(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized === STATUS_SAVED ? STATUS_SAVED : STATUS_TEMPORARY;
}

function sanitizeFileName(value, fallback = 'sequence') {
  const normalized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeName(value, fallback = 'sequence') {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return normalized || fallback;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeTopologyValue(value) {
  return String(value || '').toLowerCase().trim() === 'circular' ? 'circular' : 'linear';
}

function normalizeSequenceText(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^A-Z*]/g, '');
}

function coerceBinaryBuffer(value) {
  if (!value) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function reverseComplementIupac(sequence) {
  return [...String(sequence || '').toUpperCase()]
    .reverse()
    .map((base) => BASE_COMPLEMENT[base] || 'N')
    .join('');
}

function buildStableId(prefix, input) {
  const digest = crypto
    .createHash('sha1')
    .update(String(input || ''))
    .digest('hex');
  return `${prefix}_${digest.slice(0, 24)}`;
}

function buildEntryId() {
  return `seq_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function buildFolderId() {
  return `seq_folder_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function buildSequenceSignature(sequence, prefix = 'seq') {
  const normalized = normalizeSequenceText(sequence);
  if (!normalized.length) {
    return '';
  }

  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(index);
  }
  return `${prefix}_${normalized.length}_${(hash >>> 0).toString(16)}`;
}

function stripExtension(name) {
  const text = String(name || '').trim();
  return text ? text.replace(/\.[^.]+$/u, '') : '';
}

module.exports = {
  buildEntryId,
  buildFolderId,
  buildSequenceSignature,
  buildStableId,
  clamp,
  cleanText,
  coerceBinaryBuffer,
  normalizeName,
  normalizeSequenceText,
  normalizeStatus,
  normalizeTopologyValue,
  positiveModulo,
  reverseComplementIupac,
  sanitizeFileName,
  stripExtension
};
