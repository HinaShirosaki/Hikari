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

// Build the ordered list of inventory search terms according to the parser-selected search mode.
function buildInventorySearchTerms({
  inventorySearch = {},
  fallbackQuery = '',
  maxTerms = 10
}) {
  const normalizedQuery = cleanText(inventorySearch?.normalized_query, 220);
  const candidateTerms = uniqueStrings(inventorySearch?.candidate_terms, maxTerms);
  const aliases = uniqueStrings(inventorySearch?.aliases, maxTerms);
  const searchMode = cleanText(inventorySearch?.search_mode, 60) || 'exact_then_alias_then_fuzzy';
  const baseFallback = cleanText(fallbackQuery, 220);

  const exactTerms = uniqueStrings([
    normalizedQuery,
    ...candidateTerms,
    baseFallback
  ], maxTerms);
  const aliasTerms = uniqueStrings(aliases, maxTerms);

  if (searchMode === 'exact_only') {
    return uniqueStrings(exactTerms, maxTerms);
  }
  if (searchMode === 'alias_then_fuzzy') {
    return uniqueStrings([...aliasTerms, ...exactTerms], maxTerms);
  }
  return uniqueStrings([...exactTerms, ...aliasTerms], maxTerms);
}

module.exports = {
  buildInventorySearchTerms
};
