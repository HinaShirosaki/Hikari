'use strict';

const { asArray } = require('../../../lib/normalize.js');
const { MAX_QUERY_CHARS, MAX_TERMS, termKey, tokenize, uniqueTokens, uniqueConceptTokens } = require('./search/terms.js');
const { compileText, prepareQuery, preparePaper, prepareExperiment, scoreCompiledText, scoreCompiledFields } = require('./search/compiled.js');

function scoreTextAgainstTokens(text, tokens, { phrase = '' } = {}) {
  return scoreCompiledText(compileText(text), prepareQuery(tokens, phrase));
}

function scoreSummary(record, tokens, phrase, query = prepareQuery(tokens, phrase)) {
  return scoreCompiledFields(preparePaper(record).summary, query);
}

function scoreExperiment(experiment, tokens, phrase, query = prepareQuery(tokens, phrase)) {
  return scoreCompiledFields(prepareExperiment(experiment), query);
}

// Frozen store records share compiled fields across queries. Max detail scoring
// prevents repeated experiments from inflating a paper's rank.
function scorePaper(record, tokens, phrase, query = prepareQuery(tokens, phrase)) {
  const prepared = preparePaper(record);
  const summary = scoreCompiledFields(prepared.summary, query);
  let detailScore = 0;
  const matched = new Set(summary.matched);
  const matches = [...summary.matches];
  for (const fields of prepared.details) {
    const detail = scoreCompiledFields(fields, query);
    detailScore = Math.max(detailScore, detail.score);
    detail.matched.forEach((term) => matched.add(term));
    matches.push(...detail.matches);
  }
  return {
    score: summary.score + detailScore,
    matched: [...matched], matches,
    title_terms: summary.matches.find((match) => match.field === 'title')?.matched || [],
    doi_terms: summary.matches.find((match) => match.field === 'doi')?.matched || []
  };
}

function rankAndTrim(items, limit, tokens = []) {
  const terms = uniqueConceptTokens(tokens);
  const candidates = asArray(items).filter((item) => item && Number.isFinite(item.score)).map((item) => {
    const keys = new Set(uniqueConceptTokens(asArray(item.matched)).map(termKey));
    return { ...item, matched: terms.length ? terms.filter((term) => keys.has(termKey(term)))
      : uniqueConceptTokens(asArray(item.matched)) };
  });
  const frequencies = new Map();
  for (const item of candidates) {
    for (const term of item.matched) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  }
  const weights = new Map(terms.map((term) => [term, Math.log(1 + (candidates.length + 1)
    / (1 + (frequencies.get(term) || 0)))]));
  const totalWeight = [...weights.values()].reduce((sum, value) => sum + value, 0);
  const fieldWeight = (values) => {
    const keys = new Set(asArray(values).map(termKey));
    return terms.reduce((sum, term) => sum + (keys.has(termKey(term)) ? weights.get(term) : 0), 0);
  };
  return candidates.filter((item) => item.score > 0 && (!terms.length || item.matched.length)).map((item) => {
    const matchedWeight = item.matched.reduce((sum, term) => sum + (weights.get(term) || 0), 0);
    const coverage = totalWeight ? matchedWeight / totalWeight : 1;
    // Same-coverage title/DOI hits need an explicit provenance bonus: any
    // monotonic change to log1p alone preserves the old ordering for those ties.
    const provenance = matchedWeight
      ? (2 * fieldWeight(item.title_terms) + 4 * fieldWeight(item.doi_terms)) / matchedWeight : 0;
    return {
      ...item,
      score: totalWeight ? matchedWeight * coverage * (1 + Math.log1p(item.score) + provenance) : item.score,
      unmatched: terms.filter((term) => !item.matched.includes(term)),
      coverage: terms.length ? item.matched.length / terms.length : 1
    };
  }).sort((a, b) => b.score - a.score
    || String(a.record?.paper_id || '').localeCompare(String(b.record?.paper_id || '')))
    .slice(0, Math.max(1, limit));
}

module.exports = {
  MAX_QUERY_CHARS, MAX_TERMS, tokenize, uniqueTokens, prepareQuery, scoreTextAgainstTokens,
  scoreSummary, scoreExperiment, scorePaper, rankAndTrim
};
