'use strict';

function sanitizeOutputName(value, fallback = 'plasmid') {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function sanitizeSuffix(value) {
  const raw = String(value ?? '_pLann').trim();
  return raw.replace(/[^A-Za-z0-9._-]/g, '');
}

function normalizeSequenceInput(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('>')) {
    return raw;
  }
  const cleaned = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned) {
    return '';
  }
  const lines = [];
  for (let index = 0; index < cleaned.length; index += 80) {
    lines.push(cleaned.slice(index, index + 80));
  }
  return `>sequence\n${lines.join('\n')}\n`;
}

module.exports = {
  sanitizeOutputName,
  sanitizeSuffix,
  normalizeSequenceInput
};
