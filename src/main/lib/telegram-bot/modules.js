'use strict';

// Module catalog and search-target resolution. Translates user-facing tokens
// (e.g. "protocols", "assays") into renderer view targets and offers fuzzy
// suggestions for typos.

const { TELEGRAM_MODULE_MAP, TELEGRAM_SEARCH_TARGETS } = require('./config.js');
const { normalizeTokenKey, levenshteinDistance } = require('./text-utils.js');

function getModuleTarget(token) {
  return TELEGRAM_MODULE_MAP.get(normalizeTokenKey(token)) || null;
}

function getSearchTarget(token) {
  return TELEGRAM_SEARCH_TARGETS.get(normalizeTokenKey(token)) || null;
}

function getModuleCatalog() {
  const byView = new Map();
  TELEGRAM_MODULE_MAP.forEach((target, token) => {
    if (!byView.has(target.viewId)) {
      byView.set(target.viewId, {
        token,
        label: target.label
      });
    }
  });
  return Array.from(byView.values()).sort((a, b) => a.token.localeCompare(b.token));
}

function getModuleSuggestions(token, limit = 3) {
  const query = normalizeTokenKey(token);
  if (!query) {
    return [];
  }

  const candidates = getModuleCatalog().map((entry) => entry.token);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: levenshteinDistance(query, candidate)
    }))
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));

  const threshold = Math.max(2, Math.floor(query.length / 2));
  const closeMatches = scored
    .filter((entry) => entry.score <= threshold)
    .slice(0, limit)
    .map((entry) => entry.candidate);
  if (closeMatches.length) {
    return closeMatches;
  }

  return candidates
    .filter((candidate) => candidate.includes(query) || query.includes(candidate))
    .slice(0, limit);
}

module.exports = {
  getModuleTarget,
  getSearchTarget,
  getModuleCatalog,
  getModuleSuggestions
};
