'use strict';

const { asArray, ensureObject } = require('../../../lib/normalize.js');
const {
  cleanText,
  uniqueStrings,
  tokenizeSearchText,
  stripHtml,
  safeUrl,
  extractSourceDomain
} = require('./text-utils.js');
const {
  resolveFilters,
  deriveProductQuery,
  expandRequirementTermVariants
} = require('./requirements.js');

function buildQuerySurfaceForms(query = '') {
  const base = cleanText(query);
  if (!base) {
    return [];
  }
  const simplified = base
    .replace(/\b([A-Za-z])\.(?=\s*[A-Za-z])/g, '$1')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutDottedSpecies = base
    .replace(/\b([A-Za-z])\.\s*([A-Za-z]+)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return uniqueStrings([base, simplified, withoutDottedSpecies], 4);
}

function buildSearchQueries(input = {}) {
  const query = deriveProductQuery(input);
  const filters = resolveFilters(input);
  const surfaceForms = buildQuerySurfaceForms(query);
  return uniqueStrings([
    buildSearchQuery(input),
    ...surfaceForms.map((form) => [form, ...filters.required_terms.slice(0, 2), 'product', 'price'].filter(Boolean).join(' ')),
    ...surfaceForms.map((form) => [form, 'vendor', 'catalog'].filter(Boolean).join(' '))
  ], 4);
}

function usesCodexAgentPurchasePath(input = {}) {
  const provider = cleanText(input.provider).toLowerCase();
  return provider === 'codex';
}

function buildFastCodexSearchQueries(input = {}, filters = {}, priorRounds = []) {
  const query = deriveProductQuery(input);
  const surfaceForms = buildQuerySurfaceForms(query);
  if (asArray(priorRounds).length) {
    return uniqueStrings([
      ...deriveAdaptiveSearchQueries({ query, filters, priorRounds }),
      ...surfaceForms.map((form) => [form, 'product'].filter(Boolean).join(' '))
    ], 1);
  }
  return uniqueStrings([
    buildSearchQuery(input),
    ...surfaceForms.map((form) => [form, 'buy'].filter(Boolean).join(' '))
  ], 1);
}

function extractCandidateProductLinks(html = '', pageUrl = '', query = '', limit = 4) {
  const source = String(html || '');
  const baseDomain = extractSourceDomain(pageUrl);
  const queryTokens = new Set(tokenizeSearchText(query));
  const candidates = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = pattern.exec(source);
  while (match && candidates.length < limit * 8) {
    const url = safeUrl(match?.[1], pageUrl);
    const key = cleanText(url).toLowerCase();
    const anchorText = cleanText(stripHtml(match?.[2]));
    const combined = `${anchorText} ${url}`.trim();
    if (!key || seen.has(key)) {
      match = pattern.exec(source);
      continue;
    }
    seen.add(key);
    if (baseDomain && extractSourceDomain(url) && extractSourceDomain(url) !== baseDomain) {
      match = pattern.exec(source);
      continue;
    }
    let score = 0;
    if (/(?:\/|^)(?:products?|product-category|shop|store|catalog|item|items|sku|dp|p)(?:\/|$)/i.test(url)) {
      score += 3;
    }
    if (/\b(product|details|view|shop|buy|order|add to cart|catalog|cells?|pipettes?|kit|miniprep|maxiprep|competent|reagent|prep)\b/i.test(anchorText)) {
      score += 1;
    }
    score += tokenizeSearchText(combined).filter((token) => queryTokens.has(token)).length;
    if (/\b(login|sign in|register|privacy|terms|contact|about|blog|news|article|guide)\b/i.test(combined)) {
      score -= 3;
    }
    if (score >= 2) {
      candidates.push({
        url,
        anchor_text: anchorText,
        score
      });
    }
    match = pattern.exec(source);
  }
  return candidates
    .sort((left, right) => Number(right.score) - Number(left.score))
    .slice(0, limit);
}

function deriveAdaptiveSearchQueries({ query = '', filters = {}, priorRounds = [] } = {}) {
  const lastRound = ensureObject(asArray(priorRounds).slice(-1)[0]);
  const surfaceForms = buildQuerySurfaceForms(query);
  const missingTerms = uniqueStrings(
    asArray(priorRounds).flatMap((round) => asArray(round.missing_requirement_terms)),
    6
  );
  const termsToRefine = missingTerms.length ? missingTerms : asArray(filters.required_terms);
  const queries = [];
  if (Number(lastRound.non_product_candidate_count || 0) >= Math.max(1, Number(lastRound.strict_candidate_count || 0) + Number(lastRound.partial_candidate_count || 0))) {
    surfaceForms.forEach((form) => {
      queries.push([form, 'product', 'buy'].filter(Boolean).join(' '));
      queries.push([form, 'vendor', 'catalog'].filter(Boolean).join(' '));
    });
  }
  if (Number(lastRound.incomplete_candidate_count || 0) > 0) {
    surfaceForms.forEach((form) => {
      queries.push([form, 'price', 'shop'].filter(Boolean).join(' '));
      queries.push([form, 'add to cart'].filter(Boolean).join(' '));
    });
  }
  termsToRefine.forEach((term) => {
    expandRequirementTermVariants(term).slice(0, 3).forEach((variant) => {
      surfaceForms.forEach((form) => {
        queries.push([form, variant, 'product'].filter(Boolean).join(' '));
      });
    });
  });
  if (!queries.length) {
    surfaceForms.forEach((form) => {
      queries.push([form, 'product'].filter(Boolean).join(' '));
    });
  }
  return uniqueStrings(queries, 6);
}

function createReasoningRound(roundIndex = 0, reason = '', queries = []) {
  return {
    round_index: roundIndex + 1,
    reason: cleanText(reason),
    queries: uniqueStrings(queries, 8),
    search_query_count: uniqueStrings(queries, 8).length,
    search_result_count: 0,
    fetched_page_count: 0,
    fetch_failure_count: 0,
    incomplete_candidate_count: 0,
    non_product_candidate_count: 0,
    filtered_out_count: 0,
    strict_candidate_count: 0,
    partial_candidate_count: 0,
    followed_product_link_count: 0,
    missing_requirement_terms: []
  };
}

function buildSearchQuery(input = {}) {
  const query = deriveProductQuery(input);
  const filters = resolveFilters(input);
  return uniqueStrings([
    query,
    ...filters.required_terms,
    'buy'
  ], 12).join(' ');
}

module.exports = {
  buildQuerySurfaceForms,
  buildSearchQuery,
  buildSearchQueries,
  usesCodexAgentPurchasePath,
  buildFastCodexSearchQueries,
  extractCandidateProductLinks,
  deriveAdaptiveSearchQueries,
  createReasoningRound
};
