'use strict';

const { normalizeDoi } = require('../identity/paper-identity.js');

/**
 * Candidate ranking and de-duplication for the literature-search workflow.
 *
 * Pure functions: score a search result against the query (with a soft
 * preferred-journal bonus and recency/source tie-breakers), then rank and
 * de-dupe to the top-N distinct papers. Split out of
 * agent-literature-search-workflow.js so this parity-sensitive ranking logic
 * has one home and can be unit-tested directly.
 */

const {
  normalizePreferredWebSource,
  preferredWebSourceMatches
} = require('./agent-search-source-preferences.js');

const PAPER_TOKEN_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to',
  'was', 'were', 'with', 'without'
]);

const SOURCE_ORDER = new Map([
  ['pubmed', 0],
  ['europe_pmc', 1],
  ['crossref', 2],
  ['uniprot', 3],
  ['web', 4]
]);

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseDateToTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueByKey(items, keyFn, max = 50) {
  const seen = new Set();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (out.length >= max) {
      return;
    }
    const key = String(typeof keyFn === 'function' ? keyFn(item) : '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(item);
  });
  return out;
}

function tokenizeQuery(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !PAPER_TOKEN_STOPWORDS.has(token));
}

function normalizePaperDoi(value) {
  const doi = normalizeDoi(value);
  if (!doi) {
    return '';
  }
  // ACS and similar publishers assign a separate DOI to each supporting
  // information file. Search results should represent the parent article.
  return doi.replace(/\.s\d{3,4}$/i, '');
}

function buildCandidateKey(item = {}) {
  return String(
    normalizePaperDoi(item.doi)
    || item.pmid
    || item.pmcid
    || item.url
    || item.id
    || item.title
    || item.paper_id
    || ''
  ).trim().toLowerCase();
}

function normalizePreferredJournal(value) {
  const source = ensureObject(value);
  if (source.url || source.name) {
    const normalizedUrl = normalizePreferredWebSource(source.url);
    if (normalizedUrl) {
      return { url: normalizedUrl, name: '' };
    }
    const normalizedName = String(source.name || '').trim().toLowerCase();
    return normalizedName ? { url: '', name: normalizedName } : { url: '', name: '' };
  }
  const raw = String(value || '').trim();
  if (!raw) {
    return { url: '', name: '' };
  }
  const looksLikeUrl = /^https?:\/\//i.test(raw)
    || /^www\./i.test(raw)
    || (/\./.test(raw) && !/\s/.test(raw));
  if (looksLikeUrl) {
    const normalizedUrl = normalizePreferredWebSource(raw);
    if (normalizedUrl) {
      return { url: normalizedUrl, name: '' };
    }
  }
  return { url: '', name: raw.toLowerCase() };
}

function expandPreferredJournalCandidates(value) {
  const candidates = [];
  function pushCandidate(candidate) {
    if (Array.isArray(candidate)) {
      candidate.forEach(pushCandidate);
      return;
    }
    if (candidate && typeof candidate === 'object') {
      candidates.push(candidate);
      return;
    }
    String(candidate || '')
      .split(/[;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => candidates.push(item));
  }
  pushCandidate(value);
  return candidates;
}

function normalizePreferredJournals(value) {
  const seen = new Set();
  const normalized = [];
  expandPreferredJournalCandidates(value).forEach((candidate) => {
    const preferred = normalizePreferredJournal(candidate);
    const key = preferred.url
      ? `url:${preferred.url}`
      : (preferred.name ? `name:${preferred.name}` : '');
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(preferred);
  });
  return normalized.slice(0, 12);
}

function preferredJournalEntryBonus(item, preferred) {
  if (!preferred || (!preferred.url && !preferred.name)) {
    return 0;
  }
  const source = ensureObject(item);
  if (preferred.url) {
    const urls = [source.url, ...(Array.isArray(source.pdf_urls) ? source.pdf_urls : [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (urls.some((url) => preferredWebSourceMatches(url, preferred.url))) {
      return 6;
    }
    return 0;
  }
  const journalText = String(source.journal || '').toLowerCase();
  if (journalText && journalText.includes(preferred.name)) {
    return 6;
  }
  const fallbackHaystack = `${String(source.source || '').toLowerCase()} ${String(source.title || '').toLowerCase()}`;
  if (fallbackHaystack.includes(preferred.name)) {
    return 3;
  }
  return 0;
}

function preferredJournalBonus(item, preferred) {
  const preferences = normalizePreferredJournals(preferred);
  return preferences.reduce(
    (bestScore, preference) => Math.max(bestScore, preferredJournalEntryBonus(item, preference)),
    0
  );
}

function scorePaperCandidate(item = {}, query = '', preferredJournal = null) {
  const source = ensureObject(item);
  const queryText = String(query || '').trim().toLowerCase();
  const tokens = tokenizeQuery(queryText);
  const haystack = [
    source.title,
    source.summary,
    source.snippet,
    source.journal,
    source.source,
    source.protein_name,
    source.gene_name,
    source.organism
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');

  let score = 0;
  tokens.forEach((token) => {
    if (haystack.includes(token)) {
      score += 3;
    }
  });
  if (queryText && haystack.includes(queryText)) {
    score += 8;
  }
  if (String(source.source || '').toLowerCase() === 'pubmed') {
    score += 1.5;
  } else if (String(source.source || '').toLowerCase() === 'europe_pmc') {
    score += 1;
  }
  score += preferredJournalBonus(source, preferredJournal);
  const publishedAt = parseDateToTimestamp(source.published_at);
  if (publishedAt) {
    score += publishedAt / 1e14;
  }
  return score;
}

function selectPaperCandidates(items = [], query = '', limit = 0, preferredJournal = null) {
  const ranked = (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      ...ensureObject(item),
      __index: index,
      __score: scorePaperCandidate(item, query, preferredJournal),
      __published_at: parseDateToTimestamp(item?.published_at)
    }))
    .sort((left, right) => {
      if (right.__score !== left.__score) {
        return right.__score - left.__score;
      }
      if (right.__published_at !== left.__published_at) {
        return right.__published_at - left.__published_at;
      }
      const sourceLeft = SOURCE_ORDER.has(String(left.source || '').toLowerCase())
        ? SOURCE_ORDER.get(String(left.source || '').toLowerCase())
        : 999;
      const sourceRight = SOURCE_ORDER.has(String(right.source || '').toLowerCase())
        ? SOURCE_ORDER.get(String(right.source || '').toLowerCase())
        : 999;
      if (sourceLeft !== sourceRight) {
        return sourceLeft - sourceRight;
      }
      return left.__index - right.__index;
    });

  const requestedLimit = Number(limit);
  const maxItems = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : Number.MAX_SAFE_INTEGER;
  return uniqueByKey(ranked, buildCandidateKey, maxItems)
    .map((item) => {
      const normalized = { ...item };
      if (normalized.doi) {
        normalized.doi = normalizePaperDoi(normalized.doi);
      }
      delete normalized.__index;
      delete normalized.__score;
      delete normalized.__published_at;
      return normalized;
    });
}

module.exports = {
  PAPER_TOKEN_STOPWORDS,
  SOURCE_ORDER,
  parseDateToTimestamp,
  uniqueByKey,
  tokenizeQuery,
  normalizePaperDoi,
  buildCandidateKey,
  normalizePreferredJournal,
  normalizePreferredJournals,
  expandPreferredJournalCandidates,
  preferredJournalBonus,
  scorePaperCandidate,
  selectPaperCandidates
};
