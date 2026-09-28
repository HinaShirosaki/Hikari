'use strict';

const { normalizePaperDoi } = require('../literature-candidates.js');
const { LITERATURE_SOURCES } = require('./constants.js');
const {
  decodeXmlEntities,
  extractSourceDomain,
  safeUrl,
  stripHtml
} = require('../../../lib/web-text.js');

function toFiniteInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function clampInteger(value, fallback, min, max) {
  const parsed = toFiniteInteger(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

function toPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function firstPositiveInteger(values = [], fallback = 0) {
  for (const value of values) {
    const parsed = toPositiveInteger(value, 0);
    if (parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeSource(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized || normalized === LITERATURE_SOURCES.AUTO) {
    return LITERATURE_SOURCES.AUTO;
  }
  if (normalized === 'europepmc' || normalized === 'europe_pmc' || normalized === 'european_pmc') {
    return LITERATURE_SOURCES.EUROPE_PMC;
  }
  if (normalized === 'cross_ref' || normalized === 'doi') {
    return LITERATURE_SOURCES.CROSSREF;
  }
  if (normalized === 'uni_prot' || normalized === 'protein') {
    return LITERATURE_SOURCES.UNIPROT;
  }
  if (normalized === 'pub_med' || normalized === 'pmid') {
    return LITERATURE_SOURCES.PUBMED;
  }
  if (normalized === 'websearch' || normalized === 'search_web' || normalized === 'generic_web') {
    return LITERATURE_SOURCES.WEB;
  }
  return Object.values(LITERATURE_SOURCES).includes(normalized) ? normalized : '';
}

function buildDateFromParts(rawParts) {
  const parts = Array.isArray(rawParts) ? rawParts : [];
  const year = Number(parts[0]);
  const month = Number(parts[1] || 1);
  const day = Number(parts[2] || 1);
  if (!Number.isFinite(year) || year < 1000) {
    return '';
  }
  const safeMonth = Math.max(1, Math.min(12, month));
  const safeDay = Math.max(1, Math.min(31, day));
  const monthText = String(safeMonth).padStart(2, '0');
  const dayText = String(safeDay).padStart(2, '0');
  return `${year}-${monthText}-${dayText}`;
}

function parseDateToTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 0;
  }
  if (/^\d{4}$/.test(text)) {
    return Date.parse(`${text}-01-01`) || 0;
  }
  if (/^\d{4}-\d{2}$/.test(text)) {
    return Date.parse(`${text}-01`) || 0;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildUniProtUrl(accession) {
  const normalized = String(accession || '').trim();
  return normalized ? `https://www.uniprot.org/uniprotkb/${encodeURIComponent(normalized)}` : '';
}

function buildPubMedUrl(pmid) {
  const normalized = String(pmid || '').trim();
  return normalized ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(normalized)}/` : '';
}

function buildEuropePmcUrl({ pmcid, pmid, doi, id } = {}) {
  if (String(pmcid || '').trim()) {
    return `https://europepmc.org/article/PMC/${encodeURIComponent(String(pmcid).trim())}`;
  }
  if (String(pmid || '').trim()) {
    return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(String(pmid).trim())}/`;
  }
  const normalizedDoi = normalizePaperDoi(doi);
  if (normalizedDoi) {
    return `https://doi.org/${encodeURIComponent(normalizedDoi)}`;
  }
  if (String(id || '').trim()) {
    return `https://europepmc.org/article/MED/${encodeURIComponent(String(id).trim())}`;
  }
  return '';
}

function buildCrossrefUrl(doi, fallbackUrl = '') {
  const normalizedDoi = normalizePaperDoi(doi);
  if (normalizedDoi) {
    return `https://doi.org/${encodeURIComponent(normalizedDoi)}`;
  }
  return safeUrl(fallbackUrl);
}

module.exports = {
  toFiniteInteger,
  clampInteger,
  toPositiveInteger,
  firstPositiveInteger,
  decodeXmlEntities,
  stripHtml,
  safeUrl,
  extractSourceDomain,
  normalizeSource,
  buildDateFromParts,
  parseDateToTimestamp,
  buildUniProtUrl,
  buildPubMedUrl,
  buildEuropePmcUrl,
  buildCrossrefUrl
};
