'use strict';

const { isAgentRequestAbortError } = require('../../../lib/llm/request-context.js');
const { createAgentLlmRuntimeHelpers } = require('../../../lib/llm/runtime-helpers.js');

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 500) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function sliceText(value, max = 1200) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
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

function tokenizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function readFirstImageUrl(html, pageUrl = '') {
  const source = String(html || '');
  const pattern = /<(?:img|source)\b[^>]*(?:src|data-src|data-image|data-zoom-image)=["']([^"']+)["'][^>]*>/gi;
  let match = pattern.exec(source);
  while (match) {
    const imageUrl = safeUrl(match?.[1], pageUrl);
    if (imageUrl && !/\b(?:logo|icon|sprite|avatar|favicon|badge|placeholder)\b/i.test(imageUrl)) {
      return imageUrl;
    }
    match = pattern.exec(source);
  }
  return '';
}

function readFirstHeadingText(html, tagName = 'h1') {
  const source = String(html || '');
  const match = source.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match?.[1] ? stripHtml(match[1]) : '';
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

function looksLikeExplicitAttributeTerm(value) {
  const normalized = cleanText(value, 120).toLowerCase();
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
  const normalized = text.replace(/,/g, '').replace(/[^0-9.]+/g, '');
  if (!/[0-9]/.test(normalized)) {
    return null;
  }
  const numeric = Number(normalized);
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

function inferCurrencyFromText(value) {
  const text = cleanText(value, 120).toUpperCase();
  if (!text) {
    return '';
  }
  if (text.includes('$') || text.includes('USD')) {
    return 'USD';
  }
  if (text.includes('EUR') || text.includes('€')) {
    return 'EUR';
  }
  if (text.includes('GBP') || text.includes('£')) {
    return 'GBP';
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
      const description = cleanText(
        source.description
          || source.disambiguatingDescription
          || source.category
          || source.keywords,
        1600
      );
      return {
        id: cleanText(source.sku || source.productID || source.mpn || source.gtin13 || source.name || productUrl, 220),
        title: cleanText(source.name, 320),
        description,
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
  const loosePrice = extractLoosePrice(html);
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
  const priceValue = normalizePriceValue(priceText) ?? loosePrice.price_value;
  const normalizedCurrency = currency || loosePrice.currency;
  const normalizedPriceText = formatCurrency(priceValue, normalizedCurrency, priceText || loosePrice.price_text);
  return {
    id: cleanText(canonicalUrl || pageUrl || readTagValue(html, 'title'), 220),
    title: cleanText(
      readMetaContent(html, 'property', 'og:title')
      || readMetaContent(html, 'name', 'twitter:title')
      || readMetaContent(html, 'itemprop', 'name')
      || readFirstHeadingText(html, 'h1')
      || readTagValue(html, 'title'),
      320
    ),
    description: cleanText(
      readMetaContent(html, 'property', 'og:description')
      || readMetaContent(html, 'name', 'description')
      || readMetaContent(html, 'name', 'twitter:description')
      || readMetaContent(html, 'itemprop', 'description'),
      1600
    ),
    vendor,
    price_value: priceValue,
    currency: normalizedCurrency,
    price_text: normalizedPriceText,
    image_url: normalizeImageUrl(
      readMetaContent(html, 'property', 'og:image')
      || readMetaContent(html, 'name', 'twitter:image')
      || readMetaContent(html, 'itemprop', 'image'),
      pageUrl
    ) || readFirstImageUrl(html, pageUrl),
    product_url: canonicalUrl || safeUrl(pageUrl),
    source_domain: extractSourceDomain(canonicalUrl || pageUrl)
  };
}

function extractLoosePrice(source = '') {
  const text = cleanText(source, 120000);
  if (!text) {
    return {
      price_value: null,
      currency: '',
      price_text: ''
    };
  }
  const defaultCurrency = normalizeCurrency(
    text.match(/"(?:priceCurrency|currency)"\s*:\s*"([A-Z$]{1,5})"/i)?.[1]
    || text.match(/'(?:priceCurrency|currency)'\s*:\s*'([A-Z$]{1,5})'/i)?.[1]
    || inferCurrencyFromText(text)
  );
  const patterns = [
    /"(?:price|lowPrice|highPrice|salePrice|amount)"\s*:\s*"([^"]+)"/ig,
    /'(?:price|lowPrice|highPrice|salePrice|amount)'\s*:\s*'([^']+)'/ig,
    /\b(?:price|sale price|our price|list price|special price|from)\b[^$€£0-9]{0,12}([$€£]?\s*[0-9][0-9,]*(?:\.[0-9]{2})?)/ig,
    /([$€£]\s*[0-9][0-9,]*(?:\.[0-9]{2})?)/g,
    /\b([0-9][0-9,]*(?:\.[0-9]{2})?)\s*(USD|EUR|GBP)\b/ig
  ];
  const candidates = [];
  patterns.forEach((pattern) => {
    let match = pattern.exec(text);
    while (match) {
      const rawPrice = cleanText(match?.[1] || `${match?.[1] || ''} ${match?.[2] || ''}`.trim(), 120)
        || cleanText(match?.[0], 120);
      const priceValue = normalizePriceValue(rawPrice);
      if (priceValue && priceValue > 0) {
        const currency = normalizeCurrency(
          inferCurrencyFromText(rawPrice)
          || inferCurrencyFromText(match?.[0])
          || cleanText(match?.[2], 12)
          || defaultCurrency
        );
        candidates.push({
          price_value: priceValue,
          currency,
          price_text: formatCurrency(priceValue, currency, rawPrice)
        });
      }
      match = pattern.exec(text);
    }
  });
  candidates.sort((left, right) => Number(left.price_value) - Number(right.price_value));
  return candidates[0] || {
    price_value: null,
    currency: '',
    price_text: ''
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

function evaluateProductCandidate(item = {}, html = '', searchResult = {}) {
  const rawHtml = String(html || '');
  const titleAndUrl = [
    cleanText(item.title, 320),
    cleanText(searchResult.title, 320),
    cleanText(item.product_url, 2000),
    cleanText(searchResult.url, 2000)
  ].join(' ');
  let score = 0;
  const signals = [];
  const blockers = [];
  if (hasFiniteNumber(item.price_value) || /[$€£]|\b(?:USD|EUR|GBP)\b/i.test(cleanText(item.price_text, 120))) {
    score += 3;
    signals.push('price_detected');
  }
  if (cleanText(item.image_url, 2000)) {
    score += 1;
    signals.push('image_detected');
  }
  if (/\b(add to cart|add-to-cart|buy now|shop now|checkout|view cart|in stock|out of stock|quantity|order now|subscribe and save|catalog number|catalog no\.?|item number|sku)\b/i.test(rawHtml)) {
    score += 3;
    signals.push('commerce_page_cues');
  }
  if (/(?:\/|^)(?:products?|product-category|shop|store|item|items|catalog|sku|dp|p)(?:\/|$)/i.test(cleanText(item.product_url || searchResult.url, 2000))) {
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
  if (!cleanText(item.title, 320)) {
    blockers.push('missing_title');
  }
  if (!cleanText(item.product_url, 2000)) {
    blockers.push('missing_product_url');
  }
  return {
    is_product: score >= 3 && !blockers.includes('missing_title') && !blockers.includes('missing_product_url'),
    signal_score: score,
    signals,
    blockers
  };
}

function buildQuerySurfaceForms(query = '') {
  const base = cleanText(query, 600);
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
  const provider = cleanText(input.provider, 80).toLowerCase();
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
    const key = cleanText(url, 2000).toLowerCase();
    const anchorText = cleanText(stripHtml(match?.[2]), 240);
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
    reason: cleanText(reason, 120),
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
    `Budget preference: ${cleanText(filters.budget_preference, 40) || '-'}`,
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
    `Search result title: ${cleanText(searchResult.title, 320) || '-'}`,
    `Search result url: ${cleanText(searchResult.url, 2000) || '-'}`,
    `Heuristic extracted title: ${cleanText(normalizedProduct.title, 320) || '-'}`,
    `Heuristic extracted vendor: ${cleanText(normalizedProduct.vendor, 180) || '-'}`,
    `Heuristic extracted price: ${cleanText(normalizedProduct.price_text, 120) || '-'}`,
    `Heuristic extracted image_url: ${cleanText(normalizedProduct.image_url, 2000) || '-'}`,
    `Heuristic product gate: ${heuristicReasoning?.product_gate?.is_product === true ? 'product' : 'not_product'}`,
    `Heuristic matched requirements: ${asArray(heuristicReasoning?.requirement_gate?.matched_requirements).join(', ') || '-'}`,
    `Heuristic missing requirements: ${asArray(heuristicReasoning?.requirement_gate?.missing_requirements).join(', ') || '-'}`,
    `Likely same-site product links: ${asArray(candidateLinks).map((item) => cleanText(item?.url || item, 2000)).filter(Boolean).join(' | ') || '-'}`,
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
    reasoning: cleanText(source.reasoning, 500)
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
    cleanText(source.price_text, 120) || fallback.price_text
  );
  return {
    is_purchasable_item: source.is_purchasable_item === true,
    meets_requirements: source.meets_requirements === true,
    title: cleanText(source.title, 320) || cleanText(fallback.title, 320),
    vendor: cleanText(source.vendor, 180) || cleanText(fallback.vendor, 180),
    price_value: priceValue != null ? priceValue : fallback.price_value,
    currency: currency || fallback.currency,
    price_text: priceText,
    image_url: safeUrl(source.image_url, fallback.product_url || fallback.page_url) || cleanText(fallback.image_url, 2000),
    product_url: safeUrl(source.product_url, fallback.page_url) || cleanText(fallback.product_url || fallback.page_url, 2000),
    matched_requirements: matchedRequirements,
    missing_requirements: missingRequirements,
    excluded_hits: excludedHits,
    product_reason: cleanText(source.product_reason, 600),
    requirement_reason: cleanText(source.requirement_reason, 600),
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

function buildRequirementHaystack(item = {}, pageText = '') {
  return [
    cleanText(item.title, 400),
    cleanText(item.description, 1600),
    cleanText(item.vendor, 220),
    cleanText(item.price_text, 80),
    cleanText(pageText, 40000)
  ].filter(Boolean).join(' ').toLowerCase();
}

function expandRequirementTermVariants(term = '') {
  const canonical = cleanText(term, 120).toLowerCase();
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
    return termMatchesHaystack(term, haystack);
  });
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
  const query = cleanText(payload.query, 220);
  const requiredTerms = asArray(payload.filters?.required_terms);
  const matchMode = cleanText(payload.match_mode, 20);
  if (cleanText(payload.status, 40) === 'matched' && items.length) {
    if (matchMode === 'partial') {
      return `Found ${items.length} likely product match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}, but I could not verify every requested attribute from the vendor pages.`;
    }
    return `Found ${items.length} purchase recommendation${items.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}${requiredTerms.length ? ` matching ${requiredTerms.join(', ')}` : ''}.`;
  }
  if (cleanText(payload.status, 40) === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can recommend something to buy.';
  }
  return `No purchase recommendations found${query ? ` for "${query}"` : ''}.`;
}

function createPurchaseRecommendationRuntime(deps = {}) {
  const {
    cleanText: runtimeCleanText,
    requestStructuredJsonPayload,
    requestWebSearch
  } = createAgentLlmRuntimeHelpers(deps);
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
        'user-agent': 'Mozilla/5.0 Hikari Purchase Recommendation'
      }
    });
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(runtimeCleanText(body, 300) || `Failed to fetch ${url}.`);
    }
    return readResponseText(response);
  }

  async function searchWebResults(query, limit = 10, input = {}) {
    if (searchWebResultsOverride) {
      const normalized = asArray(await searchWebResultsOverride({ query, limit })).map((item) => normalizeSearchResult(item)).filter((item) => item.url);
      return normalized.slice(0, limit);
    }
    if (requestWebSearch) {
      const providerSearch = await requestWebSearch({
        ...input,
        stage: 'purchase_recommendation_web_search',
        query,
        maxResults: limit,
        traceContext: input.traceContext || null
      });
      if (providerSearch?.ok) {
        return asArray(providerSearch.results).map((item) => normalizeSearchResult(item)).filter((item) => item.url).slice(0, limit);
      }
      throw new Error(cleanText(providerSearch?.error, 320) || 'Provider-layer web search is unavailable.');
    }
    throw new Error('Purchase recommendation requires provider-layer web search support.');
  }

  async function planSearchQueriesWithLlm(input = {}, filters = {}, priorRounds = []) {
    const heuristicQueries = priorRounds.length
      ? deriveAdaptiveSearchQueries({
        query: deriveProductQuery(input),
        filters,
        priorRounds
      })
      : buildSearchQueries(input);
    if (usesCodexAgentPurchasePath(input)) {
      return {
        planner: 'fast_codex_heuristic',
        reasoning: 'Using fast Codex purchase planning to avoid extra CLI round-trips.',
        queries: buildFastCodexSearchQueries(input, filters, priorRounds)
      };
    }
    if (!requestStructuredJsonPayload) {
      return {
        planner: 'heuristic',
        reasoning: 'Using heuristic search planning because no structured LLM helper is available.',
        queries: heuristicQueries
      };
    }
    try {
      const llmResult = await requestStructuredJsonPayload({
        ...input,
        stage: `purchase_recommendation_search_plan_round_${asArray(priorRounds).length + 1}`,
        systemPrompt: PURCHASE_SEARCH_PLANNER_SYSTEM_PROMPT,
        userPrompt: buildPurchaseSearchPlannerPrompt({
          query: deriveProductQuery(input),
          filters,
          priorRounds,
          heuristicQueries
        }),
        schema: PURCHASE_SEARCH_PLAN_SCHEMA,
        traceContext: input.traceContext || null,
        defaultError: 'Purchase recommendation provider is not configured.'
      });
      if (!llmResult?.ok || !llmResult.payload) {
        return {
          planner: 'heuristic_fallback',
          reasoning: cleanText(llmResult?.error, 320) || 'Falling back to heuristic search planning.',
          queries: heuristicQueries
        };
      }
      const normalized = normalizePurchaseSearchPlan(llmResult.payload, heuristicQueries);
      return {
        planner: 'llm',
        reasoning: normalized.reasoning || 'LLM planned search queries.',
        queries: normalized.search_queries.length ? normalized.search_queries : heuristicQueries
      };
    } catch (error) {
      return {
        planner: 'heuristic_fallback',
        reasoning: runtimeCleanText(error?.message || error, 320) || 'Falling back to heuristic search planning.',
        queries: heuristicQueries
      };
    }
  }

  async function judgeCandidateWithLlm({
    input = {},
    filters = {},
    searchResult = {},
    normalizedProduct = {},
    pageText = '',
    heuristicReasoning = {},
    candidateLinks = []
  } = {}) {
    if (!requestStructuredJsonPayload || usesCodexAgentPurchasePath(input)) {
      return null;
    }
    try {
      const llmResult = await requestStructuredJsonPayload({
        ...input,
        stage: 'purchase_recommendation_candidate_judge',
        systemPrompt: PURCHASE_CANDIDATE_JUDGE_SYSTEM_PROMPT,
        userPrompt: buildPurchaseCandidateJudgePrompt({
          query: deriveProductQuery(input),
          filters,
          searchResult,
          normalizedProduct,
          pageText,
          heuristicReasoning,
          candidateLinks
        }),
        schema: PURCHASE_CANDIDATE_JUDGMENT_SCHEMA,
        traceContext: input.traceContext || null,
        defaultError: 'Purchase recommendation provider is not configured.'
      });
      if (!llmResult?.ok || !llmResult.payload) {
        return null;
      }
      return normalizePurchaseCandidateJudgment(llmResult.payload, {
        ...normalizedProduct,
        page_url: cleanText(searchResult.url, 2000)
      }, filters);
    } catch {
      return null;
    }
  }

  function aggregateDiagnostics(rounds = [], lastError = '') {
    return {
      search_query_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.search_query_count || 0), 0),
      search_result_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.search_result_count || 0), 0),
      fetched_page_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.fetched_page_count || 0), 0),
      fetch_failure_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.fetch_failure_count || 0), 0),
      incomplete_candidate_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.incomplete_candidate_count || 0), 0),
      non_product_candidate_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.non_product_candidate_count || 0), 0),
      filtered_out_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.filtered_out_count || 0), 0),
      followed_product_link_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.followed_product_link_count || 0), 0),
      last_error: cleanText(lastError, 320),
      reasoning_rounds: asArray(rounds).map((round) => ({
        ...round,
        queries: uniqueStrings(round?.queries, 8),
        missing_requirement_terms: uniqueStrings(round?.missing_requirement_terms, 12)
      }))
    };
  }

  async function execute(input = {}) {
    const query = deriveProductQuery(input);
    const filters = resolveFilters(input);
    const fastCodexPath = usesCodexAgentPurchasePath(input);
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

    const limit = clampInteger(input.limit, 6, 1, 6);
    const searchLimit = clampInteger(input.search_limit, fastCodexPath ? 6 : 10, 1, 16);
    const maxReasoningRounds = clampInteger(input.max_reasoning_rounds, fastCodexPath ? 1 : (requestStructuredJsonPayload ? 3 : 2), 1, 4);
    const maxLinkedPagesPerResult = clampInteger(input.link_follow_limit, fastCodexPath ? 1 : 3, 0, 4);
    const maxInspectionDepth = clampInteger(input.max_link_depth, 1, 0, 2);
    const inspectionConcurrency = clampInteger(input.inspection_concurrency, fastCodexPath ? 4 : 2, 1, 6);
    const strictCandidates = [];
    const partialCandidates = [];
    const reasoningRounds = [];
    const seenSearchQueryKeys = new Set();
    const seenSearchResultUrls = new Set();
    const seenInspectedUrls = new Set();
    let lastError = '';

    async function inspectCandidateUrl(searchResult = {}, round = {}, searchIndex = 0, depth = 0, inspectionPath = []) {
      const currentUrl = cleanText(searchResult.url, 2000);
      const currentKey = currentUrl.toLowerCase();
      if (!currentUrl || seenInspectedUrls.has(currentKey)) {
        return;
      }
      seenInspectedUrls.add(currentKey);
      try {
        const html = await fetchText(currentUrl);
        round.fetched_page_count += 1;
        const pageText = stripHtml(html);
        const product = extractProductFromHtml(html, currentUrl);
        const snippetPrice = extractLoosePrice(searchResult.summary);
        const normalizedProduct = {
          ...product,
          title: cleanText(product.title || searchResult.title, 320),
          image_url: cleanText(product.image_url, 2000) || readFirstImageUrl(html, currentUrl),
          price_value: product.price_value ?? snippetPrice.price_value,
          currency: product.currency || snippetPrice.currency,
          price_text: product.price_text || snippetPrice.price_text,
          product_url: cleanText(product.product_url, 2000) || currentUrl,
          source_domain: cleanText(product.source_domain, 120) || searchResult.source_domain
        };
        const heuristicReasoning = runProductReasoningLoop({
          item: normalizedProduct,
          html,
          searchResult,
          filters,
          pageText
        });
        const heuristicLinks = extractCandidateProductLinks(html, currentUrl, query, maxLinkedPagesPerResult);
        const llmJudgment = await judgeCandidateWithLlm({
          input,
          filters,
          searchResult,
          normalizedProduct,
          pageText,
          heuristicReasoning,
          candidateLinks: heuristicLinks
        });
        const reasoning = mergePurchaseReasoning({
          heuristicReasoning,
          llmJudgment,
          filters
        });
        const resolvedProduct = llmJudgment
          ? {
            ...normalizedProduct,
            title: cleanText(llmJudgment.title, 320) || normalizedProduct.title,
            vendor: cleanText(llmJudgment.vendor, 180) || normalizedProduct.vendor,
            price_value: llmJudgment.price_value ?? normalizedProduct.price_value,
            currency: llmJudgment.currency || normalizedProduct.currency,
            price_text: llmJudgment.price_text || normalizedProduct.price_text,
            image_url: cleanText(llmJudgment.image_url, 2000) || normalizedProduct.image_url,
            product_url: cleanText(llmJudgment.product_url, 2000) || normalizedProduct.product_url
          }
          : normalizedProduct;
        const evaluation = reasoning.requirement_gate || evaluateProductRequirementMatch(resolvedProduct, filters, pageText);
        const followUpLinks = uniqueStrings([
          ...asArray(reasoning.suggested_links),
          ...heuristicLinks.map((item) => cleanText(item?.url, 2000))
        ], maxLinkedPagesPerResult);

        if (asArray(evaluation.missing_requirements).length) {
          round.missing_requirement_terms.push(...asArray(evaluation.missing_requirements));
        }

        if (!reasoning.product_gate?.is_product) {
          round.non_product_candidate_count += 1;
          if (depth < maxInspectionDepth) {
            for (const followUpUrl of followUpLinks) {
              if (strictCandidates.length >= limit) {
                break;
              }
              round.followed_product_link_count += 1;
              await inspectCandidateUrl({
                title: cleanText(
                  heuristicLinks.find((item) => cleanText(item?.url, 2000) === followUpUrl)?.anchor_text || searchResult.title,
                  320
                ),
                url: followUpUrl,
                summary: searchResult.summary,
                source_domain: extractSourceDomain(followUpUrl)
              }, round, searchIndex, depth + 1, [...inspectionPath, currentUrl]);
            }
          }
          return;
        }

        const hasCompleteCard = !!(
          cleanText(resolvedProduct.image_url, 2000)
          && cleanText(resolvedProduct.vendor, 180)
          && cleanText(resolvedProduct.price_text, 120)
          && cleanText(resolvedProduct.product_url, 2000)
        );
        if (!hasCompleteCard) {
          round.incomplete_candidate_count += 1;
          if (depth < maxInspectionDepth) {
            for (const followUpUrl of followUpLinks) {
              if (strictCandidates.length >= limit) {
                break;
              }
              round.followed_product_link_count += 1;
              await inspectCandidateUrl({
                title: cleanText(
                  heuristicLinks.find((item) => cleanText(item?.url, 2000) === followUpUrl)?.anchor_text || searchResult.title,
                  320
                ),
                url: followUpUrl,
                summary: searchResult.summary,
                source_domain: extractSourceDomain(followUpUrl)
              }, round, searchIndex, depth + 1, [...inspectionPath, currentUrl]);
            }
          }
          return;
        }

        if (asArray(evaluation.excluded_hits).length) {
          round.filtered_out_count += 1;
          return;
        }

        const normalizedCandidate = {
          ...resolvedProduct,
          id: cleanText(resolvedProduct.id, 220) || `product-${searchIndex + 1}`,
          source_domain: cleanText(resolvedProduct.source_domain, 120) || searchResult.source_domain,
          matched_requirements: asArray(evaluation.matched_requirements),
          unverified_requirements: asArray(evaluation.missing_requirements),
          candidate_reasoning: {
            product_gate: reasoning.product_gate,
            requirement_gate: evaluation,
            reasoning_source: cleanText(reasoning.reasoning_source, 40) || 'heuristic',
            inspection_path: uniqueStrings([...inspectionPath, currentUrl], 6),
            product_reason: cleanText(llmJudgment?.product_reason, 600),
            requirement_reason: cleanText(llmJudgment?.requirement_reason, 600)
          },
          _search_index: searchIndex
        };

        if (reasoning.accept_as_strict) {
          strictCandidates.push(normalizedCandidate);
          round.strict_candidate_count += 1;
        } else if (reasoning.accept_as_partial) {
          partialCandidates.push(normalizedCandidate);
          round.partial_candidate_count += 1;
          round.filtered_out_count += 1;
        }
      } catch (error) {
        if (isAgentRequestAbortError(error)) {
          throw error;
        }
        round.fetch_failure_count += 1;
        lastError = runtimeCleanText(error?.message || error, 300);
      }
    }

    async function runReasoningRound(roundIndex = 0) {
      const plan = await planSearchQueriesWithLlm(input, filters, reasoningRounds);
      const plannedQueries = uniqueStrings(plan.queries, 8)
        .filter((queryText) => {
          const key = cleanText(queryText, 320).toLowerCase();
          if (!key || seenSearchQueryKeys.has(key)) {
            return false;
          }
          seenSearchQueryKeys.add(key);
          return true;
        });
      if (!plannedQueries.length) {
        return null;
      }
      const round = createReasoningRound(roundIndex, plan.reasoning || plan.planner, plannedQueries);
      round.planner = cleanText(plan.planner, 40) || 'heuristic';
      const searchResults = [];
      for (const searchQuery of plannedQueries) {
        let batch = [];
        try {
          batch = await searchWebResults(searchQuery, searchLimit, input);
        } catch (error) {
          if (isAgentRequestAbortError(error)) {
            throw error;
          }
          lastError = runtimeCleanText(error?.message || error, 320);
          continue;
        }
        asArray(batch).forEach((rawResult) => {
          if (searchResults.length >= searchLimit) {
            return;
          }
          const normalized = normalizeSearchResult(rawResult);
          const key = cleanText(normalized.url, 2000).toLowerCase();
          if (!key || seenSearchResultUrls.has(key)) {
            return;
          }
          seenSearchResultUrls.add(key);
          searchResults.push(normalized);
        });
        if (searchResults.length >= searchLimit) {
          break;
        }
      }
      round.search_result_count = searchResults.length;
      const pendingInspections = [];
      for (let index = 0; index < searchResults.length; index += 1) {
        if (strictCandidates.length >= limit) {
          break;
        }
        pendingInspections.push(inspectCandidateUrl(searchResults[index], round, index, 0, []));
        if (pendingInspections.length >= inspectionConcurrency) {
          await Promise.all(pendingInspections.splice(0, pendingInspections.length));
          if (strictCandidates.length >= limit) {
            break;
          }
        }
      }
      if (pendingInspections.length) {
        await Promise.all(pendingInspections);
      }
      return round;
    }

    for (let roundIndex = 0; roundIndex < maxReasoningRounds; roundIndex += 1) {
      const round = await runReasoningRound(roundIndex);
      if (!round) {
        break;
      }
      reasoningRounds.push(round);
      if (strictCandidates.length >= limit) {
        break;
      }
      if (!round.search_result_count && roundIndex > 0) {
        break;
      }
    }

    let items = dedupeAndRankProducts(strictCandidates, filters, limit);
    let matchMode = items.length ? 'strict' : 'none';
    if (!items.length && partialCandidates.length) {
      items = dedupeAndRankProducts(partialCandidates, filters, limit);
      if (items.length) {
        matchMode = 'partial';
      }
    }
    const result = {
      ok: true,
      status: items.length ? 'matched' : 'no_match',
      query,
      source: 'web',
      match_mode: matchMode,
      filters,
      items,
      follow_up_questions: items.length
        ? (matchMode === 'partial'
          ? ['Some requested attributes could not be verified from the vendor pages.']
          : [])
        : ['Try a more specific product name or relax one of the required attributes.']
    };
    const diagnostics = aggregateDiagnostics(reasoningRounds, lastError);
    if (!items.length) {
      if (!diagnostics.search_result_count && diagnostics.last_error) {
        result.summary = diagnostics.last_error;
      } else if (!diagnostics.search_result_count) {
        result.summary = `No search results were returned${query ? ` for "${query}"` : ''}.`;
      } else if (!diagnostics.fetched_page_count && diagnostics.fetch_failure_count) {
        result.summary = `I could not retrieve vendor product pages${query ? ` for "${query}"` : ''}.`;
      } else if (diagnostics.non_product_candidate_count && !diagnostics.incomplete_candidate_count && !diagnostics.filtered_out_count) {
        result.summary = `I found search hits, but they did not appear to be direct purchasable product pages${query ? ` for "${query}"` : ''}.`;
      } else if (diagnostics.incomplete_candidate_count && !diagnostics.filtered_out_count) {
        result.summary = `I found candidate pages but could not extract complete product details${query ? ` for "${query}"` : ''}.`;
      } else if (diagnostics.filtered_out_count) {
        result.summary = `I found candidate products, but none clearly matched the required attributes${query ? ` for "${query}"` : ''}.`;
      } else if (diagnostics.last_error) {
        result.summary = diagnostics.last_error;
      } else {
        result.summary = summarizePurchaseRecommendation(result);
      }
    } else {
      result.summary = summarizePurchaseRecommendation(result);
    }
    result.diagnostics = diagnostics;
    return result;
  }

  return {
    parseDelimitedTerms,
    normalizeBudgetPreference,
    normalizeRequiredTerms,
    resolveFilters,
    deriveProductQuery,
    buildSearchQuery,
    extractProductFromHtml,
    extractLoosePrice,
    buildSearchQueries,
    deriveAdaptiveSearchQueries,
    buildPurchaseSearchPlannerPrompt,
    buildPurchaseCandidateJudgePrompt,
    normalizePurchaseSearchPlan,
    normalizePurchaseCandidateJudgment,
    mergePurchaseReasoning,
    extractCandidateProductLinks,
    evaluateProductCandidate,
    runProductReasoningLoop,
    evaluateProductRequirementMatch,
    summarizePurchaseRecommendation,
    execute
  };
}

module.exports = {
  createPurchaseRecommendationRuntime,
  parseDelimitedTerms,
  normalizeBudgetPreference,
  normalizeRequiredTerms,
  resolveFilters,
  deriveProductQuery,
  buildSearchQuery,
  buildSearchQueries,
  extractProductFromHtml,
  extractLoosePrice,
  deriveAdaptiveSearchQueries,
  buildPurchaseSearchPlannerPrompt,
  buildPurchaseCandidateJudgePrompt,
  normalizePurchaseSearchPlan,
  normalizePurchaseCandidateJudgment,
  mergePurchaseReasoning,
  extractCandidateProductLinks,
  evaluateProductCandidate,
  runProductReasoningLoop,
  evaluateProductRequirementMatch,
  summarizePurchaseRecommendation
};
