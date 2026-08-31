'use strict';

const { ensureObject } = require('../../../lib/normalize.js');
const {
  cleanText,
  safeUrl,
  extractSourceDomain,
  hasFiniteNumber
} = require('./text-utils.js');

function formatCurrency(priceValue, currency = '', rawPriceText = '') {
  if (hasFiniteNumber(priceValue) && cleanText(currency)) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: cleanText(currency).toUpperCase()
      }).format(Number(priceValue));
    } catch {
      // Fall through to simpler formatting.
    }
  }
  if (cleanText(rawPriceText)) {
    return cleanText(rawPriceText);
  }
  if (hasFiniteNumber(priceValue)) {
    return `$${Number(priceValue).toFixed(2)}`;
  }
  return '';
}

function normalizePriceValue(value) {
  const text = cleanText(value);
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
  const text = cleanText(value).toUpperCase();
  if (/^[A-Z]{3}$/.test(text)) {
    return text;
  }
  if (text === '$' || /USD/.test(text)) {
    return 'USD';
  }
  return '';
}

function inferCurrencyFromText(value) {
  const text = cleanText(value).toUpperCase();
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
  const text = cleanText(source);
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
  const rawPriceText = cleanText(source.price);
  return {
    price_value: priceValue,
    currency,
    price_text: formatCurrency(priceValue, currency, rawPriceText),
    product_url: safeUrl(source.url, baseUrl),
    vendor: normalizeVendorName(source.seller || source.vendor || source.merchant || source.offeredBy, baseUrl)
  };
}

module.exports = {
  formatCurrency,
  normalizePriceValue,
  normalizeCurrency,
  inferCurrencyFromText,
  normalizeVendorName,
  normalizeImageUrl,
  normalizeOffer
};
