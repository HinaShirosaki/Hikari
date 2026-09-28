'use strict';

const { createUniqueStrings } = require('./value-utils.js');

function defaultCleanText(value) {
  return String(value || '').trim();
}

function normalizePreferredJournalNames(value, cleanText = defaultCleanText, uniqueStrings = null) {
  const candidates = [];
  function pushCandidate(candidate) {
    if (Array.isArray(candidate)) {
      candidate.forEach(pushCandidate);
      return;
    }
    if (candidate && typeof candidate === 'object') {
      pushCandidate(candidate.name || candidate.url || candidate.href || '');
      return;
    }
    String(candidate || '')
      .split(/[;\n]+/u)
      .map((item) => cleanText(item, 240).trim())
      .filter(Boolean)
      .forEach((item) => candidates.push(item));
  }
  pushCandidate(value);
  const dedupe = typeof uniqueStrings === 'function'
    ? uniqueStrings
    : createUniqueStrings(cleanText, 240);
  return dedupe(candidates, 12);
}

module.exports = { normalizePreferredJournalNames };
