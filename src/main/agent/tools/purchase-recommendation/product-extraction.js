'use strict';

const { asArray, ensureObject } = require('../../../lib/normalize.js');
const {
  cleanText,
  decodeHtmlEntities,
  stripHtml,
  safeUrl,
  extractSourceDomain
} = require('./text-utils.js');
const {
  formatCurrency,
  normalizePriceValue,
  normalizeCurrency,
  inferCurrencyFromText,
  normalizeVendorName,
  normalizeImageUrl,
  normalizeOffer
} = require('./pricing.js');

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
    const rawBlock = cleanText(match[1])
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
    .map((item) => cleanText(item).toLowerCase());
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
        || cleanText(selectedOffer.product_url)
        || readCanonicalUrl(html, pageUrl);
      const vendor = normalizeVendorName(
        source.brand || source.manufacturer || source.seller || selectedOffer.vendor,
        productUrl || pageUrl
      );
      const priceValue = selectedOffer.price_value;
      const currency = selectedOffer.currency;
      const rawPriceText = selectedOffer.price_text || cleanText(source.price);
      const priceText = formatCurrency(priceValue, currency, rawPriceText);
      const description = cleanText(
        source.description
          || source.disambiguatingDescription
          || source.category
          || source.keywords);
      return {
        id: cleanText(source.sku || source.productID || source.mpn || source.gtin13 || source.name || productUrl),
        title: cleanText(source.name),
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
      || readMetaContent(html, 'property', 'og:price:amount'));
  const currency = normalizeCurrency(
    readMetaContent(html, 'property', 'product:price:currency')
      || readMetaContent(html, 'itemprop', 'priceCurrency')
      || readMetaContent(html, 'property', 'og:price:currency')
  );
  const priceValue = normalizePriceValue(priceText) ?? loosePrice.price_value;
  const normalizedCurrency = currency || loosePrice.currency;
  const normalizedPriceText = formatCurrency(priceValue, normalizedCurrency, priceText || loosePrice.price_text);
  return {
    id: cleanText(canonicalUrl || pageUrl || readTagValue(html, 'title')),
    title: cleanText(
      readMetaContent(html, 'property', 'og:title')
      || readMetaContent(html, 'name', 'twitter:title')
      || readMetaContent(html, 'itemprop', 'name')
      || readFirstHeadingText(html, 'h1')
      || readTagValue(html, 'title')),
    description: cleanText(
      readMetaContent(html, 'property', 'og:description')
      || readMetaContent(html, 'name', 'description')
      || readMetaContent(html, 'name', 'twitter:description')
      || readMetaContent(html, 'itemprop', 'description')),
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
  const text = cleanText(source);
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
      const rawPrice = cleanText(match?.[1] || `${match?.[1] || ''} ${match?.[2] || ''}`.trim())
        || cleanText(match?.[0]);
      const priceValue = normalizePriceValue(rawPrice);
      if (priceValue && priceValue > 0) {
        const currency = normalizeCurrency(
          inferCurrencyFromText(rawPrice)
          || inferCurrencyFromText(match?.[0])
          || cleanText(match?.[2])
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

module.exports = {
  readTagValue,
  readMetaContent,
  readCanonicalUrl,
  readFirstImageUrl,
  readFirstHeadingText,
  flattenJsonLdNodes,
  extractJsonLdBlocks,
  nodeLooksLikeProduct,
  extractJsonLdProducts,
  extractFallbackProduct,
  extractLoosePrice,
  extractProductFromHtml
};
