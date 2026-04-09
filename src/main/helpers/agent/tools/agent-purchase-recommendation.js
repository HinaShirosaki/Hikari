'use strict';

const { isAgentRequestAbortError } = require('../shared/agent-request-context.js');

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const output = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 220);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || output.length >= max) {
      return;
    }
    seen.add(key);
    output.push(normalized);
  });
  return output;
}

function clampInteger(value, fallback = 6, min = 1, max = 25) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    });
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value, baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw, baseUrl || undefined);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function extractSourceDomain(url) {
  const normalized = safeUrl(url);
  if (!normalized) {
    return '';
  }
  try {
    return String(new URL(normalized).hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

function readTagValue(html, tagName) {
  const match = String(html || '').match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match?.[1] ? stripHtml(match[1]) : '';
}

function readMetaContent(html, attrName, attrValue) {
  const patterns = [
    new RegExp(`<meta\\b[^>]*${attrName}=["']${attrValue}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${attrValue}["'][^>]*>`, 'i')
  ];
  const source = String(html || '');
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }
  return '';
}

function readCanonicalUrl(html, pageUrl = '') {
  const source = String(html || '');
  const match = source.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    || source.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  return safeUrl(match?.[1], pageUrl) || safeUrl(pageUrl);
}

function parseDelimitedTerms(value, max = 12) {
  if (Array.isArray(value)) {
    return uniqueStrings(value, max);
  }
  return uniqueStrings(
    String(value || '')
      .split(/\s*(?:,|;|\n|(?:\band\b)|(?:\bor\b))\s*/i)
      .map((part) => cleanText(part, 120))
      .filter(Boolean),
    max
  );
}

function normalizeBudgetPreference(value) {
  const normalized = cleanText(value, 80).toLowerCase();
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

function hasFiniteNumber(value) {
  if (value == null || value === '') {
    return false;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric);
}

function formatCurrency(priceValue, currency = '', rawPriceText = '') {
  if (hasFiniteNumber(priceValue) && cleanText(currency, 12)) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: cleanText(currency, 12).toUpperCase()
      }).format(Number(priceValue));
    } catch {
      // Fall through to simpler formatting.
    }
  }
  if (cleanText(rawPriceText, 120)) {
    return cleanText(rawPriceText, 120);
  }
  if (hasFiniteNumber(priceValue)) {
    return `$${Number(priceValue).toFixed(2)}`;
  }
  return '';
}

function normalizePriceValue(value) {
  const text = cleanText(value, 120);
  if (!text) {
    return null;
  }
  const numeric = Number(text.replace(/[^0-9.]+/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeCurrency(value) {
  const text = cleanText(value, 12).toUpperCase();
  if (/^[A-Z]{3}$/.test(text)) {
    return text;
  }
  if (text === '$' || /USD/.test(text)) {
    return 'USD';
  }
  return '';
}

function normalizeVendorName(value, fallbackUrl = '') {
  const source = value && typeof value === 'object'
    ? (value.name || value.brand || value.legalName || value.alternateName)
    : value;
  const text = cleanText(source, 180);
  if (text) {
    return text;
  }
  return extractSourceDomain(fallbackUrl);
}

function normalizeImageUrl(value, baseUrl = '') {
  if (Array.isArray(value)) {
    return normalizeImageUrl(value[0], baseUrl);
  }
  if (value && typeof value === 'object') {
    return normalizeImageUrl(value.url || value.contentUrl || value.thumbnailUrl, baseUrl);
  }
  return safeUrl(value, baseUrl);
}

function normalizeOffer(offer = {}, baseUrl = '') {
  const source = ensureObject(offer);
  const priceValue = normalizePriceValue(source.price || source.lowPrice || source.highPrice);
  const currency = normalizeCurrency(source.priceCurrency || source.currency);
  const rawPriceText = cleanText(source.price, 120);
  return {
    price_value: priceValue,
    currency,
    price_text: formatCurrency(priceValue, currency, rawPriceText),
    product_url: safeUrl(source.url, baseUrl),
    vendor: normalizeVendorName(source.seller || source.vendor || source.merchant || source.offeredBy, baseUrl)
  };
}

function flattenJsonLdNodes(value, output = []) {
  if (!value) {
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => flattenJsonLdNodes(entry, output));
    return output;
  }
  if (typeof value !== 'object') {
    return output;
  }
  output.push(value);
  if (Array.isArray(value['@graph'])) {
    flattenJsonLdNodes(value['@graph'], output);
  }
  return output;
}

function extractJsonLdBlocks(html = '') {
  const blocks = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = pattern.exec(String(html || ''));
  while (match) {
    const rawBlock = cleanText(match[1], 200000)
      .replace(/^<!\[CDATA\[/, '')
      .replace(/\]\]>$/, '');
    if (rawBlock) {
      try {
        blocks.push(JSON.parse(rawBlock));
      } catch {
        // Ignore malformed JSON-LD blocks.
      }
    }
    match = pattern.exec(String(html || ''));
  }
  return blocks;
}

function nodeLooksLikeProduct(node = {}) {
  const rawType = node?.['@type'];
  const types = asArray(rawType).concat(typeof rawType === 'string' ? [rawType] : [])
    .map((item) => cleanText(item, 80).toLowerCase());
  return types.includes('product');
}

function extractJsonLdProducts(html = '', pageUrl = '') {
  const nodes = extractJsonLdBlocks(html).flatMap((block) => flattenJsonLdNodes(block, []));
  return nodes
    .filter((node) => nodeLooksLikeProduct(node))
    .map((node) => {
      const source = ensureObject(node);
      const offers = asArray(source.offers).length
        ? asArray(source.offers)
        : (source.offers ? [source.offers] : []);
      const normalizedOffers = offers.map((offer) => normalizeOffer(offer, pageUrl));
      const selectedOffer = normalizedOffers.find((offer) => offer.price_text || offer.price_value != null)
        || normalizedOffers[0]
        || {};
      const productUrl = safeUrl(source.url, pageUrl)
        || cleanText(selectedOffer.product_url, 2000)
        || readCanonicalUrl(html, pageUrl);
      const vendor = normalizeVendorName(
        source.brand || source.manufacturer || source.seller || selectedOffer.vendor,
        productUrl || pageUrl
      );
      const priceValue = selectedOffer.price_value;
      const currency = selectedOffer.currency;
      const rawPriceText = selectedOffer.price_text || cleanText(source.price, 120);
      const priceText = formatCurrency(priceValue, currency, rawPriceText);
      return {
        id: cleanText(source.sku || source.productID || source.mpn || source.gtin13 || source.name || productUrl, 220),
        title: cleanText(source.name, 320),
        vendor,
        price_value: priceValue,
        currency,
        price_text: priceText,
        image_url: normalizeImageUrl(source.image, pageUrl),
        product_url: productUrl,
        source_domain: extractSourceDomain(productUrl || pageUrl)
      };
    })
    .filter((item) => item.title || item.product_url);
}

function extractFallbackProduct(html = '', pageUrl = '') {
  const canonicalUrl = readCanonicalUrl(html, pageUrl) || safeUrl(pageUrl);
  const vendor = normalizeVendorName(
    readMetaContent(html, 'property', 'og:site_name')
      || readMetaContent(html, 'name', 'application-name')
      || readMetaContent(html, 'itemprop', 'brand'),
    canonicalUrl || pageUrl
  );
  const priceText = cleanText(
    readMetaContent(html, 'property', 'product:price:amount')
      || readMetaContent(html, 'name', 'twitter:data1')
      || readMetaContent(html, 'itemprop', 'price')
      || readMetaContent(html, 'property', 'og:price:amount'),
    120
  );
  const currency = normalizeCurrency(
    readMetaContent(html, 'property', 'product:price:currency')
      || readMetaContent(html, 'itemprop', 'priceCurrency')
      || readMetaContent(html, 'property', 'og:price:currency')
  );
  const priceValue = normalizePriceValue(priceText);
  const normalizedPriceText = formatCurrency(priceValue, currency, priceText);
  return {
    id: cleanText(canonicalUrl || pageUrl || readTagValue(html, 'title'), 220),
    title: cleanText(
      readMetaContent(html, 'property', 'og:title')
      || readMetaContent(html, 'name', 'twitter:title')
      || readMetaContent(html, 'itemprop', 'name')
      || readTagValue(html, 'title'),
      320
    ),
    vendor,
    price_value: priceValue,
    currency,
    price_text: normalizedPriceText,
    image_url: normalizeImageUrl(
      readMetaContent(html, 'property', 'og:image')
      || readMetaContent(html, 'name', 'twitter:image')
      || readMetaContent(html, 'itemprop', 'image'),
      pageUrl
    ),
    product_url: canonicalUrl || safeUrl(pageUrl),
    source_domain: extractSourceDomain(canonicalUrl || pageUrl)
  };
}

function extractProductFromHtml(html = '', pageUrl = '') {
  const jsonLdProducts = extractJsonLdProducts(html, pageUrl);
  const completeJsonLdProduct = jsonLdProducts.find((item) => item.image_url && item.vendor && item.price_text && item.product_url);
  if (completeJsonLdProduct) {
    return completeJsonLdProduct;
  }
  const fallback = extractFallbackProduct(html, pageUrl);
  if (fallback.image_url && fallback.vendor && fallback.price_text && fallback.product_url) {
    return fallback;
  }
  return completeJsonLdProduct || fallback;
}

function normalizeSearchResult(raw = {}) {
  const source = ensureObject(raw);
  const url = safeUrl(source.url || source.link);
  return {
    title: cleanText(source.title, 320),
    url,
    summary: cleanText(source.summary || source.snippet || source.description, 600),
    source_domain: cleanText(source.source_domain, 120).toLowerCase() || extractSourceDomain(url)
  };
}

function parseWebRssItems(xml, limit = 10) {
  const items = [];
  const pattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match = pattern.exec(String(xml || ''));
  while (match && items.length < limit) {
    const block = match[1];
    const title = readTagValue(block, 'title');
    const url = safeUrl(readTagValue(block, 'link'));
    const summary = readTagValue(block, 'description');
    if (title || url || summary) {
      items.push(normalizeSearchResult({
        title,
        url,
        summary
      }));
    }
    match = pattern.exec(String(xml || ''));
  }
  return items;
}

function buildRequirementHaystack(item = {}, pageText = '') {
  return [
    cleanText(item.title, 400),
    cleanText(item.vendor, 220),
    cleanText(item.price_text, 80),
    cleanText(pageText, 40000)
  ].filter(Boolean).join(' ').toLowerCase();
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
    const key = cleanText(item.product_url || `${item.title}|${item.vendor}|${item.price_text}`, 400).toLowerCase();
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

function resolveFilters(input = {}) {
  const parserPayload = ensureObject(input.parser_payload || input.parserPayload);
  const entities = ensureObject(parserPayload.entities);
  const message = cleanText(input.message, 1200);
  const requiredTerms = uniqueStrings([
    ...parseDelimitedTerms(entities.required_attributes, 12),
    ...parseDelimitedTerms(input.required_terms, 12)
  ], 12);
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
      || input.message,
    600
  );
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

function buildMatchedRequirements(item = {}, filters = {}, pageText = '') {
  const haystack = buildRequirementHaystack(item, pageText);
  return asArray(filters.required_terms).filter((term) => {
    const normalized = cleanText(term, 120).toLowerCase();
    return normalized && haystack.includes(normalized);
  });
}

function productMatchesFilters(item = {}, filters = {}, pageText = '') {
  const haystack = buildRequirementHaystack(item, pageText);
  const requiredTerms = asArray(filters.required_terms);
  const excludedTerms = asArray(filters.excluded_terms);
  if (requiredTerms.some((term) => {
    const normalized = cleanText(term, 120).toLowerCase();
    return normalized && !haystack.includes(normalized);
  })) {
    return false;
  }
  if (excludedTerms.some((term) => {
    const normalized = cleanText(term, 120).toLowerCase();
    return normalized && haystack.includes(normalized);
  })) {
    return false;
  }
  return true;
}

function summarizePurchaseRecommendation(result = {}) {
  const payload = ensureObject(result);
  const items = asArray(payload.items);
  const query = cleanText(payload.query, 220);
  const requiredTerms = asArray(payload.filters?.required_terms);
  if (cleanText(payload.status, 40) === 'matched' && items.length) {
    return `Found ${items.length} purchase recommendation${items.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}${requiredTerms.length ? ` matching ${requiredTerms.join(', ')}` : ''}.`;
  }
  if (cleanText(payload.status, 40) === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can recommend something to buy.';
  }
  return `No purchase recommendations found${query ? ` for "${query}"` : ''}.`;
}

function createPurchaseRecommendationRuntime(deps = {}) {
  const runtimeCleanText = typeof deps.cleanText === 'function' ? deps.cleanText : cleanText;
  const fetchImpl = typeof deps.fetch === 'function'
    ? deps.fetch
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const searchWebResultsOverride = typeof deps.searchWebResults === 'function' ? deps.searchWebResults : null;

  async function readResponseText(response) {
    if (typeof response?.text === 'function') {
      return String(await response.text());
    }
    if (typeof response?.json === 'function') {
      return JSON.stringify(await response.json());
    }
    return '';
  }

  async function fetchText(url) {
    if (!fetchImpl) {
      throw new Error('Purchase recommendation requires fetch support.');
    }
    const response = await fetchImpl(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 Enana Purchase Recommendation'
      }
    });
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(runtimeCleanText(body, 300) || `Failed to fetch ${url}.`);
    }
    return readResponseText(response);
  }

  async function searchWebResults(query, limit = 10) {
    if (searchWebResultsOverride) {
      const normalized = asArray(await searchWebResultsOverride({ query, limit })).map((item) => normalizeSearchResult(item)).filter((item) => item.url);
      return normalized.slice(0, limit);
    }
    const xml = await fetchText(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`);
    return parseWebRssItems(xml, limit);
  }

  async function execute(input = {}) {
    const query = deriveProductQuery(input);
    const filters = resolveFilters(input);
    if (!query) {
      return {
        ok: true,
        status: 'needs_more_info',
        query: '',
        source: 'parser_only',
        filters,
        items: [],
        follow_up_questions: ['Please tell me what item you want to buy.'],
        summary: 'I need more detail before I can recommend something to buy.'
      };
    }

    const searchQuery = buildSearchQuery(input);
    const limit = clampInteger(input.limit, 6, 1, 6);
    const searchLimit = clampInteger(input.search_limit, 10, 1, 16);
    const searchResults = await searchWebResults(searchQuery, searchLimit);
    const extractedProducts = [];

    for (let index = 0; index < searchResults.length; index += 1) {
      const searchResult = searchResults[index];
      if (!cleanText(searchResult.url, 2000)) {
        continue;
      }
      try {
        const html = await fetchText(searchResult.url);
        const pageText = stripHtml(html);
        const product = extractProductFromHtml(html, searchResult.url);
        if (!product.image_url || !product.vendor || !product.price_text || !product.product_url) {
          continue;
        }
        if (!productMatchesFilters(product, filters, pageText)) {
          continue;
        }
        extractedProducts.push({
          ...product,
          id: cleanText(product.id, 220) || `product-${index + 1}`,
          source_domain: cleanText(product.source_domain, 120) || searchResult.source_domain,
          matched_requirements: buildMatchedRequirements(product, filters, pageText),
          _search_index: index
        });
      } catch (error) {
        if (isAgentRequestAbortError(error)) {
          throw error;
        }
      }
    }

    const items = dedupeAndRankProducts(extractedProducts, filters, limit);
    const result = {
      ok: true,
      status: items.length ? 'matched' : 'no_match',
      query,
      source: 'web',
      filters,
      items,
      follow_up_questions: items.length ? [] : ['Try a more specific product name or relax one of the required attributes.']
    };
    result.summary = summarizePurchaseRecommendation(result);
    return result;
  }

  return {
    parseDelimitedTerms,
    normalizeBudgetPreference,
    resolveFilters,
    deriveProductQuery,
    buildSearchQuery,
    extractProductFromHtml,
    summarizePurchaseRecommendation,
    execute
  };
}

module.exports = {
  createPurchaseRecommendationRuntime,
  parseDelimitedTerms,
  normalizeBudgetPreference,
  resolveFilters,
  deriveProductQuery,
  buildSearchQuery,
  extractProductFromHtml,
  summarizePurchaseRecommendation
};
