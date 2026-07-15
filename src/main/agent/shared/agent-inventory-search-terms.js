'use strict';

// Shared inventory search-term builder used by the live inventory-lookup path
// (codex + skills). Extracted from the self-implemented agent's intent parser so
// live tools don't depend on /self-agent. ponytail: self-contained, no shared deps.

function cleanText(value, _maxLength = 500) {
  return String(value || '').trim();
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

// Build the deduped list of inventory search terms from candidate terms plus the fallback query.
function buildInventorySearchTerms({
  inventorySearch = {},
  fallbackQuery = '',
  maxTerms = 10
}) {
  const candidateTerms = uniqueStrings(inventorySearch?.candidate_terms, maxTerms);
  const baseFallback = cleanText(fallbackQuery, 220);

  return uniqueStrings([
    ...candidateTerms,
    baseFallback
  ], maxTerms);
}

module.exports = {
  buildInventorySearchTerms
};
