'use strict';

/**
 * Keyword scoring + snippet extraction for paper-wiki chunk search.
 *
 * Pure functions: tokenize a query (stopword-filtered), score a chunk row
 * (term hits + heading boost + coverage bonus + exact-phrase bonus + mild
 * length normalization), and build a snippet / page citation. Split out of
 * agent-paper-wiki-search.js so this parity-sensitive ranking has one home and
 * can be unit-tested without a SQLite index.
 */

const MAX_QUERY_CHARS = 400;
const MAX_TERMS = 12;
const MIN_TERM_LENGTH = 2;
const SNIPPET_RADIUS = 220;
const HEADING_BOOST = 3;
const PHRASE_BOOST = 4;
const LENGTH_NORMALIZATION_K = 600;

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does',
  'doing', 'don', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just',
  'me', 'might', 'more', 'most', 'must', 'my', 'myself', 'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'present', 'said', 'same', 'shall', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to',
  'too', 'under', 'until', 'up', 'use', 'used', 'using', 'very', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'would', 'yes', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

function tokenize(value) {
  return String(value || '')
    .slice(0, MAX_QUERY_CHARS)
    .toLowerCase()
    .split(/[^a-z0-9_\-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TERM_LENGTH && !STOPWORDS.has(token))
    .slice(0, MAX_TERMS);
}

function uniqueTerms(tokens) {
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

function countOccurrences(haystackLower, needle) {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let from = 0;
  while (true) {
    const found = haystackLower.indexOf(needle, from);
    if (found < 0) {
      break;
    }
    count += 1;
    from = found + needle.length;
  }
  return count;
}

function scoreRow(row, terms, phrase) {
  const body = String(row.body_lower || '').toLowerCase();
  const heading = String(row.section_heading || '').toLowerCase();
  if (!terms.length) {
    return 0;
  }
  let score = 0;
  let termsHit = 0;
  for (const term of terms) {
    const bodyHits = countOccurrences(body, term);
    const headingHits = countOccurrences(heading, term);
    if (bodyHits > 0 || headingHits > 0) {
      termsHit += 1;
    }
    score += bodyHits + (headingHits * HEADING_BOOST);
  }
  if (termsHit === 0) {
    return 0;
  }
  // Coverage bonus: heavily reward matching more distinct query terms.
  score *= 1 + (termsHit / terms.length);
  // Phrase bonus: an exact substring match of the original query is the strongest signal.
  if (phrase && phrase.length >= MIN_TERM_LENGTH && body.includes(phrase)) {
    score += PHRASE_BOOST;
  }
  // Mild length normalization so a long generic section doesn't dominate by raw hit count.
  const charLength = Number.isFinite(row.char_length) ? row.char_length : body.length;
  score *= LENGTH_NORMALIZATION_K / (LENGTH_NORMALIZATION_K + charLength);
  return score;
}

function buildSnippet(body, terms, phrase) {
  const text = String(body || '');
  if (!text) {
    return '';
  }
  const haystack = text.toLowerCase();
  let bestIndex = -1;
  if (phrase && phrase.length >= MIN_TERM_LENGTH) {
    const phraseHit = haystack.indexOf(phrase);
    if (phraseHit >= 0) {
      bestIndex = phraseHit;
    }
  }
  if (bestIndex < 0) {
    for (const term of terms) {
      const found = haystack.indexOf(term);
      if (found >= 0 && (bestIndex < 0 || found < bestIndex)) {
        bestIndex = found;
      }
    }
  }
  if (bestIndex < 0) {
    return text.slice(0, SNIPPET_RADIUS * 2);
  }
  const start = Math.max(0, bestIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, bestIndex + SNIPPET_RADIUS);
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < text.length ? ' …' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function buildPageCitation(row) {
  const start = Number.isFinite(row.page_start) ? row.page_start : null;
  const end = Number.isFinite(row.page_end) ? row.page_end : null;
  if (start == null && end == null) {
    return '';
  }
  if (start != null && end != null && start !== end) {
    return `pp. ${start}-${end}`;
  }
  return `p. ${start ?? end}`;
}

module.exports = {
  MAX_QUERY_CHARS,
  tokenize,
  uniqueTerms,
  scoreRow,
  buildSnippet,
  buildPageCitation
};
