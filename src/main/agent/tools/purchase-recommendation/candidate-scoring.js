'use strict';

const { asArray, ensureObject } = require('../../../lib/normalize.js');
const {
  cleanText,
  safeUrl,
  extractSourceDomain,
  hasFiniteNumber
} = require('./text-utils.js');
const { evaluateProductRequirementMatch } = require('./requirements.js');

function evaluateProductCandidate(item = {}, html = '', searchResult = {}) {
  const rawHtml = String(html || '');
  const titleAndUrl = [
    cleanText(item.title),
    cleanText(searchResult.title),
    cleanText(item.product_url),
    cleanText(searchResult.url)
  ].join(' ');
  let score = 0;
  const signals = [];
  const blockers = [];
  if (hasFiniteNumber(item.price_value) || /[$€£]|\b(?:USD|EUR|GBP)\b/i.test(cleanText(item.price_text))) {
    score += 3;
    signals.push('price_detected');
  }
  if (cleanText(item.image_url)) {
    score += 1;
    signals.push('image_detected');
  }
  if (/\b(add to cart|add-to-cart|buy now|shop now|checkout|view cart|in stock|out of stock|quantity|order now|subscribe and save|catalog number|catalog no\.?|item number|sku)\b/i.test(rawHtml)) {
    score += 3;
    signals.push('commerce_page_cues');
  }
  if (/(?:\/|^)(?:products?|product-category|shop|store|item|items|catalog|sku|dp|p)(?:\/|$)/i.test(cleanText(item.product_url || searchResult.url))) {
    score += 2;
    signals.push('product_like_url');
  }
  if (/application\/ld\+json|itemprop=["']price["']|product:price|priceCurrency|price_amount|offers/i.test(rawHtml)) {
    score += 1;
    signals.push('structured_product_markup');
  }
  if (/\b(definition|definitions|structure|types?|functions?|examples?|applications?|guide|guides|protocol|review|reviews|blog|news|article|what is|learn|notes?)\b/i.test(titleAndUrl) && score < 4) {
    score -= 3;
    blockers.push('article_like_page');
  }
  if (!cleanText(item.title)) {
    blockers.push('missing_title');
  }
  if (!cleanText(item.product_url)) {
    blockers.push('missing_product_url');
  }
  return {
    is_product: score >= 3 && !blockers.includes('missing_title') && !blockers.includes('missing_product_url'),
    signal_score: score,
    signals,
    blockers
  };
}

function normalizeSearchResult(raw = {}) {
  const source = ensureObject(raw);
  const url = safeUrl(source.url || source.link);
  return {
    title: cleanText(source.title),
    url,
    summary: cleanText(source.summary || source.snippet || source.description),
    source_domain: cleanText(source.source_domain).toLowerCase() || extractSourceDomain(url)
  };
}

function scoreProduct(item = {}, filters = {}) {
  let score = Number.isFinite(Number(item._search_index)) ? Number(item._search_index) * -1 : 0;
  score += asArray(item.matched_requirements).length * 20;
  if (filters.budget_preference === 'cheap' && hasFiniteNumber(item.price_value)) {
    score -= Number(item.price_value);
  }
  return score;
}

function dedupeAndRankProducts(items = [], filters = {}, limit = 6) {
  const seen = new Set();
  const deduped = [];
  asArray(items).forEach((item) => {
    const key = cleanText(item.product_url || `${item.title}|${item.vendor}|${item.price_text}`).toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(item);
  });

  return deduped
    .sort((left, right) => {
      if (filters.budget_preference === 'cheap') {
        const leftPrice = hasFiniteNumber(left.price_value) ? Number(left.price_value) : Number.POSITIVE_INFINITY;
        const rightPrice = hasFiniteNumber(right.price_value) ? Number(right.price_value) : Number.POSITIVE_INFINITY;
        if (leftPrice !== rightPrice) {
          return leftPrice - rightPrice;
        }
      }
      return scoreProduct(right, filters) - scoreProduct(left, filters);
    })
    .slice(0, limit)
    .map((item) => {
      const normalized = { ...item };
      delete normalized._search_index;
      return normalized;
    });
}

function runProductReasoningLoop({ item = {}, html = '', searchResult = {}, filters = {}, pageText = '' } = {}) {
  const productGate = evaluateProductCandidate(item, html, searchResult);
  if (!productGate.is_product) {
    return {
      product_gate: productGate,
      requirement_gate: null,
      accept_as_strict: false,
      accept_as_partial: false,
      rejection_reason: 'not_product'
    };
  }
  const requirementGate = evaluateProductRequirementMatch(item, filters, pageText);
  return {
    product_gate: productGate,
    requirement_gate: requirementGate,
    accept_as_strict: requirementGate.strict_match || !asArray(filters.required_terms).length,
    accept_as_partial: requirementGate.excluded_hits.length === 0,
    rejection_reason: requirementGate.excluded_hits.length ? 'excluded_terms' : ''
  };
}

function summarizePurchaseRecommendation(result = {}) {
  const payload = ensureObject(result);
  const items = asArray(payload.items);
  const query = cleanText(payload.query);
  const requiredTerms = asArray(payload.filters?.required_terms);
  const matchMode = cleanText(payload.match_mode);
  if (cleanText(payload.status) === 'matched' && items.length) {
    if (matchMode === 'partial') {
      return `Found ${items.length} likely product match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}, but I could not verify every requested attribute from the vendor pages.`;
    }
    return `Found ${items.length} purchase recommendation${items.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}${requiredTerms.length ? ` matching ${requiredTerms.join(', ')}` : ''}.`;
  }
  if (cleanText(payload.status) === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item)).filter(Boolean).join(' ')
      || 'I need more detail before I can recommend something to buy.';
  }
  return `No purchase recommendations found${query ? ` for "${query}"` : ''}.`;
}

module.exports = {
  evaluateProductCandidate,
  normalizeSearchResult,
  scoreProduct,
  dedupeAndRankProducts,
  runProductReasoningLoop,
  summarizePurchaseRecommendation
};
