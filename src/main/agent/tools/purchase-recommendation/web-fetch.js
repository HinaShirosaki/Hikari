'use strict';

const { asArray } = require('../../../lib/normalize.js');
const { cleanText } = require('./text-utils.js');
const { normalizeSearchResult } = require('./candidate-scoring.js');

// Fetching a vendor page and running the provider-layer web search. Both are
// injected so tests can drive the runtime without network access.
function createPurchaseWebFetch({
  fetchImpl,
  requestWebSearch,
  searchWebResultsOverride,
  runtimeCleanText
} = {}) {
  async function readResponseText(response) {
    if (typeof response?.text === 'function') {
      return String(await response.text());
    }
    if (typeof response?.json === 'function') {
      return JSON.stringify(await response.json());
    }
    return '';
  }

  async function fetchText(url) {
    if (!fetchImpl) {
      throw new Error('Purchase recommendation requires fetch support.');
    }
    const response = await fetchImpl(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 Hikari Purchase Recommendation'
      }
    });
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(runtimeCleanText(body, 300) || `Failed to fetch ${url}.`);
    }
    return readResponseText(response);
  }

  async function searchWebResults(query, limit = 10, input = {}) {
    if (searchWebResultsOverride) {
      const normalized = asArray(await searchWebResultsOverride({ query, limit })).map((item) => normalizeSearchResult(item)).filter((item) => item.url);
      return normalized.slice(0, limit);
    }
    if (requestWebSearch) {
      const providerSearch = await requestWebSearch({
        ...input,
        stage: 'purchase_recommendation_web_search',
        query,
        maxResults: limit,
        traceContext: input.traceContext || null
      });
      if (providerSearch?.ok) {
        return asArray(providerSearch.results).map((item) => normalizeSearchResult(item)).filter((item) => item.url).slice(0, limit);
      }
      throw new Error(cleanText(providerSearch?.error) || 'Provider-layer web search is unavailable.');
    }
    throw new Error('Purchase recommendation requires provider-layer web search support.');
  }

  return { readResponseText, fetchText, searchWebResults };
}

module.exports = { createPurchaseWebFetch };
