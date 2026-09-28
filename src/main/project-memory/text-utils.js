'use strict';

const { ensureObject } = require('../lib/normalize.js');

function cleanText(value) {
  return String(value || '');
}

function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return !cleaned || /^\.+$/.test(cleaned) ? fallback : cleaned;
}

function sanitizeProjectMemoryFolderName(value, fallback = 'Untitled_Project') {
  return sanitizeFolderName(value, fallback);
}

function normalizeFolderKey(value) {
  return sanitizeFolderName(value, '').toLowerCase();
}

function pickLatestTimestamp(...values) {
  let latest = '';
  let latestMs = 0;
  values.forEach((value) => {
    const normalized = cleanText(value, 80);
    const ms = Date.parse(normalized);
    if (normalized && Number.isFinite(ms) && ms >= latestMs) {
      latest = normalized;
      latestMs = ms;
    }
  });
  return latest;
}

function hasWorkflowContext(value) {
  const workflowContext = ensureObject(value?.workflowContext);
  return Boolean(
    cleanText(workflowContext.workflowId, 220)
    || cleanText(workflowContext.workflowEntryId, 220)
    || cleanText(workflowContext.workflowBlockId, 220)
  );
}

function humanizeStatus(value, fallback = 'not done') {
  const normalized = cleanText(value, 80)
    .replace(/[_-]+/g, ' ')
    .trim();
  return normalized || fallback;
}

function formatField(value, fallback = 'None recorded.') {
  return cleanText(value, 4000) || fallback;
}

function formatTimestamp(value, fallback = 'Unknown') {
  return cleanText(value, 80) || fallback;
}

function normalizeWhitespace(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateInline(value, maxLength = 800) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  const sliced = normalized.slice(0, maxLength + 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const end = lastSpace > Math.floor(maxLength * 0.6) ? lastSpace : maxLength;
  return `${sliced.slice(0, end).trim()}…`;
}

function normalizeRelativePath(value) {
  return cleanText(value, 2400).replace(/\\/g, '/').replace(/^\/+/, '');
}

module.exports = {
  cleanText,
  formatField,
  formatTimestamp,
  hasWorkflowContext,
  humanizeStatus,
  normalizeFolderKey,
  normalizeRelativePath,
  normalizeWhitespace,
  pickLatestTimestamp,
  sanitizeProjectMemoryFolderName,
  sanitizeFolderName,
  truncateInline
};
