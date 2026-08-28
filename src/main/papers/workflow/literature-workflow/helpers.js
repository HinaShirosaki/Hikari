'use strict';

const SEARCH_BATCH_SIZE = 8;
const DEFAULT_DOWNLOAD_CONCURRENCY = 4;

function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function firstPositiveInteger(values = [], fallback = 0) {
  for (const value of values) {
    const parsed = toPositiveInteger(value, 0);
    if (parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function chunkArray(items, size) {
  const source = Array.isArray(items) ? items : [];
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize));
  }
  return chunks;
}

function sanitizeFolderName(value, fallback = 'Literature Search') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function buildDoiUrl(value) {
  const doi = String(value || '').trim();
  if (!doi) {
    return '';
  }
  return `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, '/')}`;
}

function isExplicitTrue(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

module.exports = {
  SEARCH_BATCH_SIZE,
  DEFAULT_DOWNLOAD_CONCURRENCY,
  defaultEnsureObject,
  toPositiveInteger,
  firstPositiveInteger,
  chunkArray,
  sanitizeFolderName,
  buildDoiUrl,
  isExplicitTrue
};
