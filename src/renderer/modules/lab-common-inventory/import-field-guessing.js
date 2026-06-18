import {
  CHEMICAL_IMPORT_FIELD_BY_NORMALIZED_ALIAS,
  normalizeImportHeader
} from './import-schema.js';

function guessChemicalImportField(header) {
  const normalized = normalizeImportHeader(header);
  if (!normalized) {
    return '';
  }
  const exact = CHEMICAL_IMPORT_FIELD_BY_NORMALIZED_ALIAS.get(normalized);
  if (exact) {
    return exact;
  }
  const compact = normalized.replace(/\s+/g, '');
  if (/\bcas\b/.test(normalized) || compact.includes('casregistry')) {
    return 'casNumber';
  }
  if (/\b(cat|catalog|catalogue|sku)\b/.test(normalized) || compact.includes('partnumber') || compact.includes('productnumber')) {
    return 'catalogNumber';
  }
  if (/\b(exp|expiry|expiration|expires)\b/.test(normalized) || compact.includes('bestbefore')) {
    return 'expirationDate';
  }
  if (/\b(url|link|website|web)\b/.test(normalized)) {
    return 'url';
  }
  if (/\b(vendor|supplier|manufacturer|company|brand)\b/.test(normalized)) {
    return 'vendor';
  }
  if (/\b(location|position|storage|shelf|freezer|fridge|cabinet|rack|box|room)\b/.test(normalized)) {
    return 'location';
  }
  if (/\b(stock|qty|quantity|remaining|available|inventory|count)\b/.test(normalized) || compact.includes('onhand')) {
    return 'amountInStock';
  }
  if (compact.includes('unitsize') || compact.includes('packagesize') || compact.includes('packsize') || compact.includes('bottlesize')) {
    return 'unitSize';
  }
  if (/\b(price|cost)\b/.test(normalized)) {
    return 'price';
  }
  if (/\b(name|chemical|compound|reagent|material|product|item)\b/.test(normalized) && !/\b(number|no|#|id)\b/.test(normalized)) {
    return 'name';
  }
  return '';
}

export { guessChemicalImportField };
