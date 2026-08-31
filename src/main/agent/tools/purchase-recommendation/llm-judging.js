'use strict';

const { asArray, ensureObject } = require('../../../lib/normalize.js');
const {
  cleanText,
  sliceText,
  uniqueStrings,
  safeUrl,
  hasFiniteNumber
} = require('./text-utils.js');
const {
  formatCurrency,
  normalizePriceValue,
  normalizeCurrency,
  inferCurrencyFromText
} = require('./pricing.js');
const { termMatchesHaystack } = require('./requirements.js');

const PURCHASE_SEARCH_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    search_queries: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string' }
    },
    reasoning: { type: 'string' }
  },
  required: ['search_queries', 'reasoning']
};

const PURCHASE_CANDIDATE_JUDGMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    is_purchasable_item: { type: 'boolean' },
    meets_requirements: { type: 'boolean' },
    title: { type: 'string' },
    vendor: { type: 'string' },
    price_text: { type: 'string' },
    price_value: { type: 'number' },
    currency: { type: 'string' },
    image_url: { type: 'string' },
    product_url: { type: 'string' },
    matched_requirements: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string' }
    },
    missing_requirements: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string' }
    },
    excluded_hits: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string' }
    },
    product_reason: { type: 'string' },
    requirement_reason: { type: 'string' },
    likely_product_links: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string' }
    }
  },
  required: [
    'is_purchasable_item',
    'meets_requirements',
    'matched_requirements',
    'missing_requirements',
    'excluded_hits',
    'product_reason',
    'requirement_reason',
    'likely_product_links'
  ]
};

const PURCHASE_SEARCH_PLANNER_SYSTEM_PROMPT = [
  'You are planning web search queries to find products the user can buy.',
  'Prioritize vendor product pages, catalog pages, and direct product detail pages.',
  'Avoid educational articles, definitions, blog posts, and general overview pages.',
  'Return 1 to 4 compact search queries only.'
].join(' ');

const PURCHASE_CANDIDATE_JUDGE_SYSTEM_PROMPT = [
  'You judge whether a fetched web page contains a purchasable product that fits the user request.',
  'A purchasable product should point to a vendor or seller page with concrete item details, not an article or educational overview.',
  'If the page is not itself a purchasable product, you may nominate likely product-detail links from the same vendor page.',
  'Be conservative about requirement matching and mark attributes missing when they are not supported by the page.'
].join(' ');

function buildPurchaseSearchPlannerPrompt({
  query = '',
  filters = {},
  priorRounds = [],
  heuristicQueries = []
} = {}) {
  return [
    `User product request: ${query || '-'}`,
    `Required attributes: ${asArray(filters.required_terms).join(', ') || '-'}`,
    `Excluded attributes: ${asArray(filters.excluded_terms).join(', ') || '-'}`,
    `Budget preference: ${cleanText(filters.budget_preference) || '-'}`,
    `Fallback heuristic queries: ${uniqueStrings(heuristicQueries, 6).join(' | ') || '-'}`,
    `Prior rounds: ${asArray(priorRounds).length
      ? asArray(priorRounds).map((round) => [
        `round ${round.round_index}`,
        round.reason || 'reason unavailable',
        `search_results=${Number(round.search_result_count || 0)}`,
        `strict=${Number(round.strict_candidate_count || 0)}`,
        `partial=${Number(round.partial_candidate_count || 0)}`,
        `non_product=${Number(round.non_product_candidate_count || 0)}`,
        `incomplete=${Number(round.incomplete_candidate_count || 0)}`,
        `missing=${asArray(round.missing_requirement_terms).join(', ') || '-'}`
      ].join(', ')).join('\n')
      : 'none'}`,
    'Return JSON with search_queries and reasoning.'
  ].join('\n\n');
}

function buildPurchaseCandidateJudgePrompt({
  query = '',
  filters = {},
  searchResult = {},
  normalizedProduct = {},
  pageText = '',
  heuristicReasoning = {},
  candidateLinks = []
} = {}) {
  return [
    `User product request: ${query || '-'}`,
    `Required attributes: ${asArray(filters.required_terms).join(', ') || '-'}`,
    `Excluded attributes: ${asArray(filters.excluded_terms).join(', ') || '-'}`,
    `Search result title: ${cleanText(searchResult.title) || '-'}`,
    `Search result url: ${cleanText(searchResult.url) || '-'}`,
    `Heuristic extracted title: ${cleanText(normalizedProduct.title) || '-'}`,
    `Heuristic extracted vendor: ${cleanText(normalizedProduct.vendor) || '-'}`,
    `Heuristic extracted price: ${cleanText(normalizedProduct.price_text) || '-'}`,
    `Heuristic extracted image_url: ${cleanText(normalizedProduct.image_url) || '-'}`,
    `Heuristic product gate: ${heuristicReasoning?.product_gate?.is_product === true ? 'product' : 'not_product'}`,
    `Heuristic matched requirements: ${asArray(heuristicReasoning?.requirement_gate?.matched_requirements).join(', ') || '-'}`,
    `Heuristic missing requirements: ${asArray(heuristicReasoning?.requirement_gate?.missing_requirements).join(', ') || '-'}`,
    `Likely same-site product links: ${asArray(candidateLinks).map((item) => cleanText(item?.url || item)).filter(Boolean).join(' | ') || '-'}`,
    `Page excerpt:\n${sliceText(pageText, 3500) || '-'}`,
    'Return JSON with purchasable-item judgment, requirement judgment, normalized item metadata when available, and same-site likely_product_links if the page is not itself the product detail page.'
  ].join('\n\n');
}

function normalizePurchaseSearchPlan(payload = {}, fallbackQueries = []) {
  const source = ensureObject(payload);
  return {
    search_queries: uniqueStrings([
      ...asArray(source.search_queries),
      ...fallbackQueries
    ], 4),
    reasoning: cleanText(source.reasoning)
  };
}

function normalizeRequirementTermsFromJudgment(terms = [], referenceTerms = []) {
  const judgedTerms = uniqueStrings(terms, 12);
  const requiredTerms = uniqueStrings(referenceTerms, 12);
  if (!requiredTerms.length) {
    return judgedTerms;
  }
  return requiredTerms.filter((requiredTerm) => {
    return judgedTerms.some((judgedTerm) => termMatchesHaystack(requiredTerm, judgedTerm) || termMatchesHaystack(judgedTerm, requiredTerm));
  });
}

function normalizePurchaseCandidateJudgment(payload = {}, fallback = {}, filters = {}) {
  const source = ensureObject(payload);
  const matchedRequirements = normalizeRequirementTermsFromJudgment(
    asArray(source.matched_requirements),
    filters.required_terms
  );
  const missingRequirements = uniqueStrings([
    ...normalizeRequirementTermsFromJudgment(asArray(source.missing_requirements), filters.required_terms),
    ...asArray(filters.required_terms).filter((term) => !matchedRequirements.includes(term))
  ], 12);
  const excludedHits = uniqueStrings(asArray(source.excluded_hits), 12);
  const priceValue = hasFiniteNumber(source.price_value)
    ? Number(source.price_value)
    : normalizePriceValue(source.price_text);
  const currency = normalizeCurrency(source.currency || inferCurrencyFromText(source.price_text) || fallback.currency);
  const priceText = formatCurrency(
    priceValue != null ? priceValue : fallback.price_value,
    currency || fallback.currency,
    cleanText(source.price_text) || fallback.price_text
  );
  return {
    is_purchasable_item: source.is_purchasable_item === true,
    meets_requirements: source.meets_requirements === true,
    title: cleanText(source.title) || cleanText(fallback.title),
    vendor: cleanText(source.vendor) || cleanText(fallback.vendor),
    price_value: priceValue != null ? priceValue : fallback.price_value,
    currency: currency || fallback.currency,
    price_text: priceText,
    image_url: safeUrl(source.image_url, fallback.product_url || fallback.page_url) || cleanText(fallback.image_url),
    product_url: safeUrl(source.product_url, fallback.page_url) || cleanText(fallback.product_url || fallback.page_url),
    matched_requirements: matchedRequirements,
    missing_requirements: missingRequirements,
    excluded_hits: excludedHits,
    product_reason: cleanText(source.product_reason),
    requirement_reason: cleanText(source.requirement_reason),
    likely_product_links: uniqueStrings(asArray(source.likely_product_links), 4)
      .map((url) => safeUrl(url, fallback.page_url))
      .filter(Boolean)
  };
}

function mergePurchaseReasoning({
  heuristicReasoning = {},
  llmJudgment = null,
  filters = {}
} = {}) {
  if (!llmJudgment) {
    return {
      ...heuristicReasoning,
      reasoning_source: 'heuristic',
      suggested_links: []
    };
  }
  const llmRequirementGate = {
    matched_requirements: asArray(llmJudgment.matched_requirements),
    missing_requirements: asArray(llmJudgment.missing_requirements),
    excluded_hits: asArray(llmJudgment.excluded_hits),
    strict_match: llmJudgment.meets_requirements === true
      || (asArray(llmJudgment.excluded_hits).length === 0
        && asArray(llmJudgment.missing_requirements).length === 0
        && asArray(filters.required_terms).length > 0)
  };
  return {
    product_gate: {
      ...(ensureObject(heuristicReasoning.product_gate)),
      is_product: llmJudgment.is_purchasable_item === true,
      llm_reason: llmJudgment.product_reason,
      source: 'llm'
    },
    requirement_gate: {
      ...(ensureObject(heuristicReasoning.requirement_gate)),
      ...llmRequirementGate,
      llm_reason: llmJudgment.requirement_reason
    },
    accept_as_strict: llmJudgment.is_purchasable_item === true
      && (llmRequirementGate.strict_match || !asArray(filters.required_terms).length),
    accept_as_partial: llmJudgment.is_purchasable_item === true
      && asArray(llmRequirementGate.excluded_hits).length === 0,
    rejection_reason: llmJudgment.is_purchasable_item !== true
      ? 'not_product'
      : (asArray(llmRequirementGate.excluded_hits).length ? 'excluded_terms' : ''),
    reasoning_source: 'llm',
    suggested_links: asArray(llmJudgment.likely_product_links)
  };
}

module.exports = {
  PURCHASE_SEARCH_PLAN_SCHEMA,
  PURCHASE_CANDIDATE_JUDGMENT_SCHEMA,
  PURCHASE_SEARCH_PLANNER_SYSTEM_PROMPT,
  PURCHASE_CANDIDATE_JUDGE_SYSTEM_PROMPT,
  buildPurchaseSearchPlannerPrompt,
  buildPurchaseCandidateJudgePrompt,
  normalizePurchaseSearchPlan,
  normalizeRequirementTermsFromJudgment,
  normalizePurchaseCandidateJudgment,
  mergePurchaseReasoning
};
