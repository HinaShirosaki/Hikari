'use strict';

/**
 * Tokenization + scoring helpers for paper-intake search. Mirrors the spirit of
 * the existing paper-wiki search but tuned for short, single-sentence summaries
 * and bullet-style experiment entries rather than long markdown chunks.
 */

const MAX_QUERY_CHARS = 300;
const MAX_TERMS = 12;
const MIN_TERM_LENGTH = 2;

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does',
  'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'might', 'more', 'most', 'must', 'my', 'myself', 'no', 'nor',
  'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shall', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'used', 'using', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours'
]);

function tokenize(value) {
  return String(value || '')
    .slice(0, MAX_QUERY_CHARS)
    .toLowerCase()
    .split(/[^a-z0-9_\-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TERM_LENGTH && !STOPWORDS.has(token))
    .slice(0, MAX_TERMS);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueTokens(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach((token) => {
    if (!token) {
      return;
    }
    const key = String(token).toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(key);
  });
  return out;
}

/**
 * Score a body of text against a set of query tokens. Returns the score plus
 * the list of tokens that actually matched, so callers can surface
 * `matched_terms` to the user.
 *
 * Scoring rules:
 *   - +1 per distinct query token that appears anywhere in the text.
 *   - +2 bonus when the full query phrase (joined by spaces) appears verbatim.
 *   - +0.5 for each additional occurrence of a matched token (frequency boost,
 *     capped so a giant blob can't outweigh a tight summary).
 *   - Score normalized by sqrt(text length / 200) so a 1-sentence summary that
 *     mentions every term beats a 10-sentence paragraph that mentions them once.
 */
function scoreTextAgainstTokens(text, tokens, { phrase = '' } = {}) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack || !tokens.length) {
    return { score: 0, matched: [] };
  }
  const matched = [];
  let raw = 0;
  tokens.forEach((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'g');
    const hits = haystack.match(re);
    if (hits && hits.length) {
      matched.push(token);
      raw += 1 + Math.min(hits.length - 1, 4) * 0.5;
    }
  });
  const phraseText = String(phrase || '').trim().toLowerCase();
  if (phraseText && phraseText.length >= 3 && haystack.includes(phraseText)) {
    raw += 2;
  }
  if (raw <= 0) {
    return { score: 0, matched: [] };
  }
  const normalization = Math.sqrt(Math.max(haystack.length, 50) / 200);
  return {
    score: raw / normalization,
    matched: uniqueTokens(matched)
  };
}

/**
 * Score an intake record's one-sentence summary against the query. Title and
 * DOI also count, with a small boost on title matches because titles often
 * carry the strongest topical signal.
 */
function scoreSummary(record, tokens, phrase) {
  const summary = String(record?.one_sentence_summary || '');
  const title = String(record?.title || '');
  const summaryScore = scoreTextAgainstTokens(summary, tokens, { phrase });
  const titleScore = scoreTextAgainstTokens(title, tokens, { phrase });
  const combined = summaryScore.score + titleScore.score * 1.5;
  const matched = uniqueTokens([...summaryScore.matched, ...titleScore.matched]);
  return { score: combined, matched };
}

/**
 * Score a single experiment entry against the query. Each field is scored
 * separately so a query like "western blot HEK293" can match `technique`
 * + `variables` even when the title doesn't mention either.
 */
function scoreExperiment(experiment, tokens, phrase) {
  const fields = [
    { text: experiment?.title, weight: 1.4 },
    { text: experiment?.technique, weight: 1.3 },
    { text: experiment?.variables, weight: 1.0 },
    { text: experiment?.outcome, weight: 0.8 },
    { text: experiment?.figure_ref, weight: 0.4 }
  ];
  let total = 0;
  const matched = [];
  fields.forEach(({ text, weight }) => {
    const result = scoreTextAgainstTokens(text, tokens, { phrase });
    total += result.score * weight;
    result.matched.forEach((token) => matched.push(token));
  });
  return { score: total, matched: uniqueTokens(matched) };
}

function rankAndTrim(items, limit) {
  return asArray(items)
    .filter((item) => item && item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

module.exports = {
  MAX_QUERY_CHARS,
  MAX_TERMS,
  tokenize,
  uniqueTokens,
  scoreTextAgainstTokens,
  scoreSummary,
  scoreExperiment,
  rankAndTrim
};
