'use strict';

const { normalizeText, termKey, textTerms, uniqueConceptTokens } = require('./terms.js');
const { asArray } = require('../../../../lib/normalize.js');
const compiledPapers = new WeakMap();
const compiledExperiments = new WeakMap();

function prepareQuery(tokens, phrase = '') {
  const terms = uniqueConceptTokens(tokens);
  return { terms, keys: terms.map(termKey), phrase: normalizeText(phrase) };
}

function compileText(value) {
  const text = String(value || '');
  const counts = new Map();
  const words = textTerms(text);
  for (const word of words) {
    const key = termKey(word);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { text, counts, normalized: ` ${normalizeText(text)} `,
    normalization: Math.sqrt(Math.max(1, words.length / 40)) };
}

function compileFields(fields, texts = new Map()) {
  return fields.filter(([, text]) => text).map(([field, text, weight]) => {
    const key = String(text);
    if (!texts.has(key)) texts.set(key, compileText(key));
    return { field, weight, ...texts.get(key) };
  });
}

function compileSummary(record, texts) {
  return compileFields([
    ['title', record?.title, 1.5], ['one_sentence_summary', record?.one_sentence_summary, 1],
    ['doi', record?.doi, 3], ['paper_id', record?.paper_id, 0.5]
  ], texts);
}

function prepareExperiment(experiment, texts) {
  if (compiledExperiments.has(experiment)) return compiledExperiments.get(experiment);
  const fields = compileFields([
    ['title', experiment?.title, 1.4], ['technique', experiment?.technique, 1.3],
    ['variables', experiment?.variables, 1], ['outcome', experiment?.outcome, 0.8],
    ['figure_ref', experiment?.figure_ref, 0.4], ['evidence', experiment?.evidence, 0.7]
  ], texts);
  if (experiment && Object.isFrozen(experiment)) compiledExperiments.set(experiment, fields);
  return fields;
}

function preparePaper(record) {
  if (compiledPapers.has(record)) return compiledPapers.get(record);
  // Repeated methods, conditions and evidence within a paper share one Map.
  // This matters for page-by-page inventories that mention the same assay often.
  const texts = new Map();
  const summary = compileSummary(record, texts);
  const details = [
    ...asArray(record.experiments).map((experiment) => prepareExperiment(experiment, texts).map((field) => ({
      ...field, field: `experiments.${field.field}`, experiment_id: experiment.id, figure_ref: experiment.figure_ref
    }))),
    ...asArray(record.structure_outline).map((entry) => compileFields([
      ['structure_outline.section', entry.section, 0.8], ['structure_outline.summary', entry.summary, 0.8]
    ], texts)),
    ...asArray(record.notable_claims).map((entry) => compileFields([
      ['notable_claims.section', entry.section, 0.8], ['notable_claims.claim', entry.claim, 0.8]
    ], texts))
  ];
  let estimatedBytes = 0;
  const counted = new Set();
  for (const fields of [summary, ...details]) {
    for (const field of fields) {
      estimatedBytes += 128;
      if (counted.has(field.counts)) continue;
      counted.add(field.counts);
      estimatedBytes += 2 * field.normalized.length; // Original text is charged with the record payload.
      for (const key of field.counts.keys()) estimatedBytes += 64 + 2 * key.length;
    }
  }
  const result = { summary, details, estimatedBytes };
  // Store-loaded records are immutable. Ad-hoc mutable inputs are rebuilt so
  // editing a record in place cannot silently reuse stale search terms.
  if (record && Object.isFrozen(record)) compiledPapers.set(record, result);
  return result;
}

function scoreCompiledText(field, query) {
  const matched = [];
  let score = 0;
  for (let i = 0; i < query.terms.length; i += 1) {
    const count = field.counts.get(query.keys[i]);
    if (count) {
      matched.push(query.terms[i]);
      score += 1 + Math.min(count - 1, 3) * 0.2;
    }
  }
  if (score && query.phrase && field.normalized.includes(` ${query.phrase} `)) score += 1;
  return { score: score / field.normalization, matched };
}

function scoreCompiledFields(fields, query) {
  let score = 0;
  const matched = new Set();
  const matches = [];
  for (const field of fields) {
    const result = scoreCompiledText(field, query);
    if (!result.score) continue;
    score += result.score * field.weight;
    result.matched.forEach((term) => matched.add(term));
    // Do not carry the compiled Maps into per-query results.
    matches.push({ field: field.field, text: field.text, weight: field.weight,
      experiment_id: field.experiment_id, figure_ref: field.figure_ref, ...result });
  }
  return { score, matched: [...matched], matches };
}

module.exports = { compileText, prepareQuery, preparePaper, prepareExperiment, scoreCompiledText, scoreCompiledFields };
