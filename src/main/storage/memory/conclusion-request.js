'use strict';

const { asArray, cleanText, ensureObject } = require('../storage-utils');
const { normalizeWhitespace, truncateInline } = require('./text-utils.js');

function normalizeNotebookEvidenceQuote(value) {
  let quote = normalizeWhitespace(value);
  if (quote.length < 2) {
    return quote;
  }
  const wrappers = new Map([
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’']
  ]);
  if (wrappers.get(quote[0]) === quote.at(-1)) {
    quote = normalizeWhitespace(quote.slice(1, -1));
  }
  return quote;
}

function validateNotebookConclusionResult(result, source) {
  const payload = ensureObject(result?.payload || result);
  const conclusion = truncateInline(payload.conclusion, 800);
  const canonicalQuotes = asArray(payload.quotes);
  const quotes = (canonicalQuotes.length
    ? canonicalQuotes
    : asArray(payload.supporting_quotes || payload.supportingQuotes))
    .map((quote) => normalizeNotebookEvidenceQuote(quote))
    .filter(Boolean);
  const normalizedCorpus = normalizeWhitespace(source?.corpus);
  if (
    !conclusion
    || !quotes.length
    || !normalizedCorpus
    || !quotes.every((quote) => normalizedCorpus.includes(quote))
  ) {
    return null;
  }
  return {
    // MEMORY.md carries the one-sentence summary, not the raw excerpt: it is an
    // index the agent reads in full, and quote joins do not read as sentences.
    // The quotes stay the gate — every one must appear verbatim in the saved
    // result — and are kept in the cache so a summary can be audited later.
    conclusion,
    quotes,
    model: cleanText(result?.model || payload.model, 120)
  };
}

function buildNotebookConclusionRequest(source) {
  return {
    moduleId: 'notebook',
    task: 'result-memory-conclusion',
    prompt: [
      'Generate one concise, single-line experimental conclusion from the saved result record below.',
      '',
      'Requirements:',
      '- Base the conclusion only on the supplied saved result.',
      '- Preserve uncertainty, negative findings, numbers, units, and sample identities.',
      '- Do not claim causality, statistical significance, binding affinity, or generality unless the saved result states it.',
      '- Write the conclusion as one sentence with no newline characters or Markdown.',
      '- Return 1 to 3 short supporting quotes copied exactly from the saved result.',
      '- Return exactly two JSON fields: "conclusion" as a string and "quotes" as an array of those exact substrings.',
      '- Do not add quotation-mark characters around the text inside each quotes array item.',
      '- Return JSON only.',
      '',
      `Notebook page: ${source.title || source.id}`,
      source.protocolName ? `Protocol: ${source.protocolName}` : '',
      'Saved result:',
      source.corpus
    ].filter(Boolean).join('\n'),
    systemPrompt: 'You summarize recorded experimental results as concise single-line conclusions without inventing evidence. Return the requested structured JSON only.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['conclusion', 'quotes'],
      properties: {
        conclusion: { type: 'string' },
        quotes: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: { type: 'string' }
        }
      }
    },
    maxOutputTokens: 320
  };
}

module.exports = {
  buildNotebookConclusionRequest,
  validateNotebookConclusionResult
};
