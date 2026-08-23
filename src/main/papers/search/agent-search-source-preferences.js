'use strict';

const { asArray } = require('../../lib/normalize.js');

function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  asArray(values).forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function normalizePreferredWebSource(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return String(parsed.hostname || '')
      .trim()
      .toLowerCase()
      .replace(/\.$/, '');
  } catch {
    return raw
      .replace(/^[a-z]+:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[/?#]/, 1)[0]
      .trim()
      .replace(/\.$/, '');
  }
}

function preferredWebSourceMatches(candidateDomain, preferredWebSource) {
  const normalizedCandidate = normalizePreferredWebSource(candidateDomain);
  const normalizedPreferred = normalizePreferredWebSource(preferredWebSource);
  if (!normalizedCandidate || !normalizedPreferred) {
    return false;
  }
  return normalizedCandidate === normalizedPreferred
    || normalizedCandidate.endsWith(`.${normalizedPreferred}`);
}

function prioritizePreferredWebSource(items = [], preferredWebSource = '', getDomain = null) {
  const normalizedPreferred = normalizePreferredWebSource(preferredWebSource);
  if (!normalizedPreferred) {
    return asArray(items).slice();
  }

  const resolveDomain = typeof getDomain === 'function'
    ? getDomain
    : ((item) => item?.source_domain || item?.url || '');

  return asArray(items)
    .map((item, index) => ({
      item,
      index,
      preferred: preferredWebSourceMatches(resolveDomain(item), normalizedPreferred) ? 1 : 0
    }))
    .sort((left, right) => {
      if (right.preferred !== left.preferred) {
        return right.preferred - left.preferred;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function prependPreferredValue(values = [], preferredValue = '') {
  const preferred = String(preferredValue || '').trim();
  return uniqueStrings(preferred ? [preferred, ...asArray(values)] : asArray(values));
}

module.exports = {
  normalizePreferredWebSource,
  preferredWebSourceMatches,
  prioritizePreferredWebSource,
  prependPreferredValue
};
