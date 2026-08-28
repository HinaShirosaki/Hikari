'use strict';

const { ensureObject } = require('../../../lib/normalize.js');

function defaultCleanText(value, maxLength = 4000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  const numericMax = Number(maxLength);
  if (!Number.isFinite(numericMax) || numericMax <= 0) {
    return text;
  }
  return text.length > numericMax ? text.slice(0, numericMax) : text;
}

function readPdfMetadataValue(metadata, keys = []) {
  const source = ensureObject(metadata);
  for (const key of keys) {
    let value = '';
    try {
      value = typeof metadata?.get === 'function' ? metadata.get(key) : source[key];
    } catch {
      value = '';
    }
    const cleaned = defaultCleanText(value, 1000).trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return '';
}

function normalizeEmbeddedPdfMetadata(payload = {}) {
  const source = ensureObject(payload);
  const info = ensureObject(source.info);
  const metadata = source.metadata;
  return {
    title: readPdfMetadataValue(metadata, ['dc:title', 'citation_title', 'prism:title', 'title'])
      || defaultCleanText(info.Title, 320).trim(),
    author: readPdfMetadataValue(metadata, ['dc:creator', 'citation_author', 'author'])
      || defaultCleanText(info.Author, 1000).trim(),
    subject: readPdfMetadataValue(metadata, ['dc:description', 'description', 'subject'])
      || defaultCleanText(info.Subject, 2000).trim(),
    keywords: readPdfMetadataValue(metadata, ['pdf:keywords', 'keywords'])
      || defaultCleanText(info.Keywords, 2000).trim()
  };
}

module.exports = {
  defaultCleanText,
  normalizeEmbeddedPdfMetadata
};
