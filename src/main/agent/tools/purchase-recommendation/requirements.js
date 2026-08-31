'use strict';

const { asArray, ensureObject } = require('../../../lib/normalize.js');
const {
  cleanText,
  uniqueStrings,
  tokenizeSearchText,
  normalizeMatchText
} = require('./text-utils.js');

const REQUIREMENT_TERM_ALIASES = {
  'endotoxin-free': [
    'endotoxin free',
    'low endotoxin',
    'low-endotoxin',
    'transfection grade',
    'transfection-grade'
  ],
  'metal-free': [
    'metal free',
    'trace metal',
    'trace-metal',
    'low metal'
  ],
  'latex-free': [
    'latex free'
  ],
  'nuclease-free': [
    'nuclease free',
    'rnase free',
    'dnase free',
    'rnase dnase free',
    'rnase/dnase free'
  ]
};

function parseDelimitedTerms(value, max = 12) {
  if (Array.isArray(value)) {
    return uniqueStrings(value, max);
  }
  return uniqueStrings(
    String(value || '')
      .split(/\s*(?:,|;|\n|(?:\band\b)|(?:\bor\b))\s*/i)
      .map((part) => cleanText(part))
      .filter(Boolean),
    max
  );
}

function normalizeBudgetPreference(value) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  if (/\b(cheap|budget|low cost|low-cost|affordable|inexpensive)\b/i.test(normalized)) {
    return 'cheap';
  }
  if (/\b(premium|high end|high-end|expensive)\b/i.test(normalized)) {
    return 'premium';
  }
  return normalized.replace(/\s+/g, '_');
}

function looksLikeExplicitAttributeTerm(value) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/[0-9]/.test(normalized) || normalized.includes('-')) {
    return true;
  }
  return /\b(free|sterile|filtered|coated|treated|resistant|compatible|proof|grade|autoclavable|disposable|reusable|universal|low|high|clear|opaque|amber|powder|animal|serum|xeno|nuclease|dnase|rnase|pyrogen|endotoxin|metal|latex|silicone|binding|retention)\b/i.test(normalized);
}

function normalizeRequiredTerms(terms = [], query = '') {
  const queryTokens = new Set(tokenizeSearchText(query));
  const ignorableTokens = new Set(['and', 'or', 'for', 'with', 'to', 'buy', 'item', 'product', 'kit', 'kits']);
  return uniqueStrings(terms, 12).filter((term) => {
    if (looksLikeExplicitAttributeTerm(term)) {
      return true;
    }
    const normalizedTokens = tokenizeSearchText(term).filter((token) => !ignorableTokens.has(token));
    if (!normalizedTokens.length) {
      return false;
    }
    const overlapCount = normalizedTokens.filter((token) => queryTokens.has(token)).length;
    const overlapRatio = overlapCount / normalizedTokens.length;
    return overlapRatio < 0.75;
  });
}

function buildRequirementHaystack(item = {}, pageText = '') {
  return [
    cleanText(item.title),
    cleanText(item.description),
    cleanText(item.vendor),
    cleanText(item.price_text),
    cleanText(pageText)
  ].filter(Boolean).join(' ').toLowerCase();
}

function expandRequirementTermVariants(term = '') {
  const canonical = cleanText(term).toLowerCase();
  if (!canonical) {
    return [];
  }
  return uniqueStrings([
    canonical,
    canonical.replace(/-/g, ' '),
    ...(REQUIREMENT_TERM_ALIASES[canonical] || [])
  ], 12).map((item) => normalizeMatchText(item)).filter(Boolean);
}

function termMatchesHaystack(term = '', haystack = '') {
  const normalizedHaystack = normalizeMatchText(haystack);
  if (!normalizedHaystack) {
    return false;
  }
  return expandRequirementTermVariants(term).some((variant) => variant && normalizedHaystack.includes(variant));
}

function resolveFilters(input = {}) {
  const parserPayload = ensureObject(input.parser_payload || input.parserPayload);
  const entities = ensureObject(parserPayload.entities);
  const message = cleanText(input.message);
  const query = deriveProductQuery(input);
  const requiredTerms = normalizeRequiredTerms([
    ...parseDelimitedTerms(entities.required_attributes, 12),
    ...parseDelimitedTerms(input.required_terms, 12)
  ], query);
  const excludedTerms = uniqueStrings([
    ...parseDelimitedTerms(entities.excluded_attributes, 12),
    ...parseDelimitedTerms(input.excluded_terms, 12)
  ], 12);
  const budgetPreference = normalizeBudgetPreference(
    input.budget_preference
      || entities.budget_preference
      || (/(\bcheap\b|\bbudget\b|\blow cost\b|\baffordable\b)/i.test(message) ? 'cheap' : '')
  );
  return {
    required_terms: requiredTerms,
    excluded_terms: excludedTerms,
    budget_preference: budgetPreference
  };
}

function deriveProductQuery(input = {}) {
  const parserPayload = ensureObject(input.parser_payload || input.parserPayload);
  const entities = ensureObject(parserPayload.entities);
  return cleanText(
    input.query
      || entities.product_query
      || entities.compound_name
      || entities.inventory_item
      || input.message);
}

function evaluateProductRequirementMatch(item = {}, filters = {}, pageText = '') {
  const haystack = buildRequirementHaystack(item, pageText);
  const requiredTerms = asArray(filters.required_terms);
  const excludedTerms = asArray(filters.excluded_terms);
  const matchedRequirements = requiredTerms.filter((term) => termMatchesHaystack(term, haystack));
  const missingRequirements = requiredTerms.filter((term) => !matchedRequirements.includes(term));
  const excludedHits = excludedTerms.filter((term) => termMatchesHaystack(term, haystack));
  return {
    matched_requirements: matchedRequirements,
    missing_requirements: missingRequirements,
    excluded_hits: excludedHits,
    strict_match: excludedHits.length === 0 && missingRequirements.length === 0
  };
}

module.exports = {
  REQUIREMENT_TERM_ALIASES,
  parseDelimitedTerms,
  normalizeBudgetPreference,
  looksLikeExplicitAttributeTerm,
  normalizeRequiredTerms,
  buildRequirementHaystack,
  expandRequirementTermVariants,
  termMatchesHaystack,
  resolveFilters,
  deriveProductQuery,
  evaluateProductRequirementMatch
};
